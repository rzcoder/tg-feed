// Daily getEntity probe of every source/destination chat, persisting a no-access status the UI badges; access loss is otherwise invisible until a forward fails.
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

// Consecutive failures before flipping ok→no_access (anti-flap); recovery to ok is one-shot.
const NO_ACCESS_CONSECUTIVE_FAILS = 3;

export interface AccessProbeClient {
  getEntity(entity: string | Api.TypeInputPeer | Api.TypeInputUser): Promise<unknown>;
}

export interface AccessMonitorDeps {
  client: AccessProbeClient;
  db: Db;
  bus: EventBus;
  logger: Logger;
  // default 24h
  intervalMs?: number;
  // consecutive failed probes that flip ok→no_access (default 3)
  noAccessFailThreshold?: number;
  // when set, backfills a row's null icon_data_url on a successful probe
  fetchProfilePhoto?: ProfilePhotoFetcher;
}

export interface AccessMonitor {
  start(): void;
  stop(): void;
  // run one full sweep immediately
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
  const failThreshold = deps.noAccessFailThreshold ?? NO_ACCESS_CONSECUTIVE_FAILS;
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  // Per-chat consecutive-failure counter; in-memory, resets on success and on restart.
  const failureCounts = new Map<string, number>();

  async function probe(): Promise<void> {
    if (stopped) return;
    // Serialize concurrent probes; the second caller awaits the first.
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
    // Group by chatId so a chat reused across rows is probed once per sweep.
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
      const probed = await probeOne(chatId);
      if (probed === 'skip') {
        skippedCount++;
        continue;
      }
      if (probed === 'no_access') {
        const next = (failureCounts.get(chatId) ?? 0) + 1;
        failureCounts.set(chatId, next);
        if (next < failThreshold) {
          // Under threshold: hold each target's OWN prior status (anti-flap) and just bump
          // its freshness ts. A single group-wide status would clobber a divergent badge
          // when the same chatId is both a source and a destination.
          logger.debug(
            { chatId, consecutiveFailures: next },
            'access monitor: probe failed but still under flap threshold',
          );
          for (const target of group) {
            touchCheckedAt(target);
            if (target.prevStatus === 'no_access') noAccessCount++;
            else okCount++;
          }
          continue;
        }
        // Threshold reached: flip the whole group to no_access and reset the counter so the
        // map doesn't grow unbounded for a chat that never recovers.
        failureCounts.delete(chatId);
        for (const target of group) {
          applyStatus(target, 'no_access');
        }
        noAccessCount += group.length;
        continue;
      }

      // Reachable: clear the failure counter, mark every row ok, backfill any missing icons.
      failureCounts.delete(chatId);
      for (const target of group) {
        applyStatus(target, 'ok');
      }
      okCount += group.length;
      if (fetchProfilePhoto) {
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
      // Wait the requested floodwait once; if it floods again, defer to the next tick.
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

  // Bump only the freshness timestamp, leaving the access status (and its event) untouched.
  function touchCheckedAt(target: Target): void {
    const now = new Date();
    if (target.kind === 'subscription') {
      db.update(subscriptions)
        .set({ sourceAccessCheckedAt: now })
        .where(eq(subscriptions.id, target.id))
        .run();
    } else {
      db.update(destinations)
        .set({ accessCheckedAt: now })
        .where(eq(destinations.id, target.id))
        .run();
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
