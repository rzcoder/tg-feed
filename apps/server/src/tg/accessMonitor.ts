/**
 * Periodic check that the userbot still has access to every chat the
 * forwarder cares about — both source channels (subscribed to) and
 * destination chats (forwarded to).
 *
 * The userbot can lose access without any error reaching the app: the
 * channel admin kicks it, deletes the channel, or the account swaps. The
 * symptom is that `NewMessage` stops arriving from that source and/or
 * `forwardMessages` starts failing for that destination — both invisible
 * until something tries to use them. This monitor surfaces the loss
 * proactively by calling `getEntity` on every chat once a day and writing
 * a binary status to the DB so the UI can render a "no access" badge.
 *
 * Probe granularity is per-chat (deduped across subscriptions and
 * destinations) and sequential, mirroring `resolveSubscriptionsOnStartup`'s
 * floodwait-conscious pattern. On a `FloodWaitError` we wait the requested
 * duration once; further waits are deferred to the next 24h tick.
 *
 * Status writes are diffed against the current row value: only transitions
 * emit `subscription.changed` / `destination.changed` events. The
 * `*_checked_at` timestamp is always updated so future UIs can distinguish
 * fresh from stale.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { Api } from 'telegram';
import type { Db } from '../db/client.js';
import { destinations, subscriptions } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { extractRateLimit } from '../forwarding/floodwait.js';
import type { Logger } from '../lib/logger.js';
import { createPoller } from '../lib/poller.js';
import type { ProfilePhotoFetcher } from './profilePhoto.js';

export const ACCESS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Subset of `TelegramClient` we depend on so tests can pass a stub.
export interface AccessProbeClient {
  getEntity(entity: string | Api.TypeInputPeer | Api.TypeInputUser): Promise<unknown>;
}

export interface AccessMonitorDeps {
  client: AccessProbeClient;
  db: Db;
  bus: EventBus;
  logger: Logger;
  /** Default 24h. Overridable for tests. */
  intervalMs?: number;
  /**
   * Lazy backfill: when a row's `icon_data_url` is null and the access
   * probe came back ok, the monitor calls this to fetch and stamp the
   * channel/chat profile photo. Optional — when missing (Telegram-less
   * boot, tests) the monitor only updates the access status columns.
   */
  fetchProfilePhoto?: ProfilePhotoFetcher;
}

export interface AccessMonitor {
  start(): void;
  stop(): void;
  /** Run one full sweep immediately. Exposed for tests and shutdown coverage. */
  probe(): Promise<void>;
}

interface SubscriptionTarget {
  kind: 'subscription';
  id: number;
  chatId: string;
  prevStatus: 'ok' | 'no_access';
  iconDataUrl: string | null;
}

interface DestinationTarget {
  kind: 'destination';
  id: number;
  chatId: string;
  prevStatus: 'ok' | 'no_access';
  iconDataUrl: string | null;
}

type Target = SubscriptionTarget | DestinationTarget;

export function createAccessMonitor(deps: AccessMonitorDeps): AccessMonitor {
  const { client, db, bus, logger, fetchProfilePhoto } = deps;
  const intervalMs = deps.intervalMs ?? ACCESS_CHECK_INTERVAL_MS;
  let stopped = false;
  let inFlight: Promise<void> | undefined;

  async function probe(): Promise<void> {
    if (stopped) return;
    // Serialize concurrent probes (interval tick mid-sweep is harmless but
    // doubles the load). The second caller awaits the first.
    if (inFlight) {
      await inFlight;
      return;
    }
    inFlight = runSweep().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
  }

  async function runSweep(): Promise<void> {
    const targets = collectTargets();
    if (targets.length === 0) {
      logger.debug('access monitor: no targets to check');
      return;
    }

    let okCount = 0;
    let noAccessCount = 0;
    // Group by chatId so a single chat used as both source and destination
    // (or by multiple subscriptions) is probed once per sweep.
    const byChatId = new Map<string, Target[]>();
    for (const target of targets) {
      const existing = byChatId.get(target.chatId);
      if (existing) existing.push(target);
      else byChatId.set(target.chatId, [target]);
    }

    let skippedCount = 0;
    let iconBackfillCount = 0;
    for (const [chatId, group] of byChatId) {
      if (stopped) return;
      const status = await probeOne(chatId);
      if (status === 'skip') {
        skippedCount++;
        continue;
      }
      if (status === 'ok') okCount++;
      else noAccessCount++;
      for (const target of group) {
        applyStatus(target, status);
      }
      // Icon backfill: when this chat is reachable and at least one row in
      // the group is still icon-less, fetch the profile photo once and
      // stamp it on every matching row. Skipped on `no_access` because
      // gramjs would just fail again.
      if (status === 'ok' && fetchProfilePhoto) {
        const needsIcon = group.filter((t) => t.iconDataUrl === null);
        if (needsIcon.length > 0) {
          const iconDataUrl = await fetchProfilePhoto(chatId);
          if (iconDataUrl !== null) {
            for (const target of needsIcon) {
              stampIcon(target, iconDataUrl);
              iconBackfillCount++;
            }
          }
        }
      }
    }

    logger.info(
      { okCount, noAccessCount, skippedCount, iconBackfillCount, totalChats: byChatId.size },
      'access monitor sweep complete',
    );
  }

  async function probeOne(chatId: string): Promise<'ok' | 'no_access' | 'skip'> {
    try {
      await client.getEntity(chatId);
      return 'ok';
    } catch (err) {
      const rl = extractRateLimit(err);
      if (rl === null) return 'no_access';
      // Bounded retry: wait the requested time once. If it floods again
      // we leave the chat untouched until the next tick — better than
      // burning CPU on a multi-hour cooldown.
      logger.warn({ chatId, seconds: rl.seconds }, 'access monitor: flood wait, retrying once');
      await sleep(rl.seconds * 1000);
      if (stopped) return 'skip';
      try {
        await client.getEntity(chatId);
        return 'ok';
      } catch (retryErr) {
        const retryRl = extractRateLimit(retryErr);
        if (retryRl !== null) {
          logger.warn(
            { chatId, seconds: retryRl.seconds },
            'access monitor: still flood-waiting after retry, deferring',
          );
          return 'skip';
        }
        return 'no_access';
      }
    }
  }

  function applyStatus(target: Target, status: 'ok' | 'no_access'): void {
    const now = new Date();
    if (target.kind === 'subscription') {
      db.update(subscriptions)
        .set({ sourceAccessStatus: status, sourceAccessCheckedAt: now })
        .where(eq(subscriptions.id, target.id))
        .run();
      if (target.prevStatus !== status) {
        bus.emit({
          type: 'subscription.changed',
          subscriptionId: target.id,
          change: 'updated',
        });
      }
    } else {
      db.update(destinations)
        .set({ accessStatus: status, accessCheckedAt: now })
        .where(eq(destinations.id, target.id))
        .run();
      if (target.prevStatus !== status) {
        bus.emit({
          type: 'destination.changed',
          destinationId: target.id,
          change: 'updated',
        });
      }
    }
  }

  function stampIcon(target: Target, iconDataUrl: string): void {
    if (target.kind === 'subscription') {
      db.update(subscriptions).set({ iconDataUrl }).where(eq(subscriptions.id, target.id)).run();
      bus.emit({
        type: 'subscription.changed',
        subscriptionId: target.id,
        change: 'updated',
      });
    } else {
      db.update(destinations).set({ iconDataUrl }).where(eq(destinations.id, target.id)).run();
      bus.emit({
        type: 'destination.changed',
        destinationId: target.id,
        change: 'updated',
      });
    }
  }

  function collectTargets(): Target[] {
    const subs = db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        sourceAccessStatus: subscriptions.sourceAccessStatus,
        iconDataUrl: subscriptions.iconDataUrl,
      })
      .from(subscriptions)
      .where(eq(subscriptions.enabled, true))
      .all();
    const dests = db
      .select({
        id: destinations.id,
        chatId: destinations.chatId,
        accessStatus: destinations.accessStatus,
        iconDataUrl: destinations.iconDataUrl,
      })
      .from(destinations)
      .all();
    const out: Target[] = [];
    for (const sub of subs) {
      out.push({
        kind: 'subscription',
        id: sub.id,
        chatId: sub.sourceChatId,
        prevStatus: sub.sourceAccessStatus,
        iconDataUrl: sub.iconDataUrl,
      });
    }
    for (const dest of dests) {
      out.push({
        kind: 'destination',
        id: dest.id,
        chatId: dest.chatId,
        prevStatus: dest.accessStatus,
        iconDataUrl: dest.iconDataUrl,
      });
    }
    return out;
  }

  const poller = createPoller({
    intervalMs,
    run: probe,
    logger,
    errorLogMessage: 'access monitor: probe rejected',
  });

  return {
    start: poller.start,
    stop(): void {
      stopped = true;
      poller.stop();
    },
    probe,
  };
}
