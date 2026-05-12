/**
 * Periodic safety net that catches messages the gramjs listener missed.
 *
 * The listener (`apps/server/src/tg/listener.ts`) consumes the live update
 * stream via gramjs's `NewMessage` handler. In practice that stream silently
 * stops delivering `UpdateNewChannelMessage` for some subscribed channels:
 * gramjs 2.26.x doesn't implement `client.catchUp()` and doesn't refresh
 * per-channel pts, so once a channel's update state drifts the session
 * keeps the connection alive but never dispatches events for it again.
 * Observed in production: a public broadcast channel with 23k+ messages
 * had zero `forward_log` rows ever, while a low-volume personal channel
 * forwarded fine — both verified-member, both in dialogs, both `Message`.
 *
 * This poller calls `messages.getHistory` per subscription on a short cadence
 * with `minId = lastSeen`, then enqueues anything new through the existing
 * forwarding pipeline. The listener still runs; when it works, it gets there
 * first and writes a `forward_log` row before the next poll. The poller's
 * dedup check (`forward_log` row exists?) keeps the duplicate-forward race
 * window down to the brief interval between listener-enqueue and
 * forwarder-log-write — acceptable in practice.
 *
 * State is in-memory (`Map<subscriptionId, lastSeenMessageId>`) and is
 * rebuilt on boot from `MAX(source_message_id)` in `forward_log`. For
 * subscriptions with no forward history we initialise from the current
 * channel top so we don't dump the entire backlog on first run.
 */
import { eq, and } from 'drizzle-orm';
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { Db } from '../db/client.js';
import { destinations, forwardLog, subscriptions } from '../db/schema.js';
import { toJsonSafe } from '../lib/jsonSafe.js';
import type { Logger } from '../lib/logger.js';
import { extractRateLimit } from './floodwait.js';
import type { RawForwardingHandle, RawForwardJob } from './types.js';

export const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
/** Cap per-poll batch size. New subs won't dump their entire history. */
export const POLL_BATCH_LIMIT = 100;

export interface HistoryPollerClient {
  invoke: TelegramClient['invoke'];
}

export interface HistoryPollerDeps {
  client: HistoryPollerClient;
  db: Db;
  logger: Logger;
  forwarding: RawForwardingHandle;
  intervalMs?: number;
}

export interface HistoryPoller {
  start(): void;
  stop(): void;
  /** Run one sweep across all enabled subscriptions. Exposed for tests. */
  poll(): Promise<void>;
}

interface SubRow {
  id: number;
  sourceChatId: string;
  destinationChatId: string;
}

interface RawMessage {
  id?: number;
  className?: string;
  message?: string;
  media?: unknown;
  groupedId?: { toString: () => string } | null;
  fromId?: unknown;
}

export function createHistoryPoller(deps: HistoryPollerDeps): HistoryPoller {
  const { client, db, logger, forwarding } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lastSeen = new Map<number, number>();
  // Tracks subscriptions whose seed was already established (either from
  // forward_log or from a successful channel-top probe). Subs not in this set
  // are seeded lazily on their first sweep — keeps boot fast and avoids
  // hammering Telegram before the first real poll.
  const seeded = new Set<number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let inFlight: Promise<void> | undefined;

  function selectSubs(): SubRow[] {
    return db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        destinationChatId: destinations.chatId,
      })
      .from(subscriptions)
      .innerJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .where(eq(subscriptions.enabled, true))
      .all();
  }

  function maxLoggedId(subId: number): number | undefined {
    // `source_message_id` is `text` in SQLite, so a SQL `MAX` would order
    // lexicographically (`'9' > '10'`). Fetching rows and reducing in JS is
    // correct numerically and cheap thanks to `idx_forward_log_subscription`
    // bounding the scan to one subscription's history.
    const rows = db
      .select({ sourceMessageId: forwardLog.sourceMessageId })
      .from(forwardLog)
      .where(eq(forwardLog.subscriptionId, subId))
      .all();
    if (rows.length === 0) return undefined;
    let best = -1;
    for (const r of rows) {
      const n = Number(r.sourceMessageId);
      if (Number.isFinite(n) && n > best) best = n;
    }
    return best === -1 ? undefined : best;
  }

  async function seedSub(sub: SubRow): Promise<void> {
    if (seeded.has(sub.id)) return;
    const fromLog = maxLoggedId(sub.id);
    if (fromLog !== undefined) {
      lastSeen.set(sub.id, fromLog);
      seeded.add(sub.id);
      logger.debug({ subId: sub.id, lastSeen: fromLog }, 'history poller: seeded from forward_log');
      return;
    }
    // No history — read current top so we don't backfill the archive.
    try {
      const result = (await client.invoke(
        new Api.messages.GetHistory({
          peer: sub.sourceChatId,
          limit: 1,
        }),
      )) as { messages?: RawMessage[] };
      const topId = result.messages?.[0]?.id;
      if (typeof topId === 'number') {
        lastSeen.set(sub.id, topId);
        seeded.add(sub.id);
        logger.info(
          { subId: sub.id, sourceChatId: sub.sourceChatId, lastSeen: topId },
          'history poller: seeded from channel top',
        );
      }
    } catch (err) {
      const rl = extractRateLimit(err);
      if (rl) {
        logger.warn(
          { subId: sub.id, seconds: rl.seconds },
          'history poller: flood-wait seeding sub, deferring',
        );
        return;
      }
      logger.warn(
        { subId: sub.id, sourceChatId: sub.sourceChatId, err },
        'history poller: failed to seed sub from channel top',
      );
    }
  }

  function alreadyForwarded(subId: number, sourceMessageId: string): boolean {
    const existing = db
      .select({ id: forwardLog.id })
      .from(forwardLog)
      .where(
        and(eq(forwardLog.subscriptionId, subId), eq(forwardLog.sourceMessageId, sourceMessageId)),
      )
      .get();
    return existing !== undefined;
  }

  async function pollOne(sub: SubRow): Promise<void> {
    await seedSub(sub);
    const since = lastSeen.get(sub.id);
    if (since === undefined) return;

    let result: { messages?: RawMessage[] };
    try {
      result = (await client.invoke(
        new Api.messages.GetHistory({
          peer: sub.sourceChatId,
          minId: since,
          limit: POLL_BATCH_LIMIT,
        }),
      )) as { messages?: RawMessage[] };
    } catch (err) {
      const rl = extractRateLimit(err);
      if (rl) {
        logger.warn(
          { subId: sub.id, seconds: rl.seconds },
          'history poller: flood-wait, deferring sub to next tick',
        );
        return;
      }
      logger.warn({ subId: sub.id, err }, 'history poller: getHistory failed');
      return;
    }

    const messages = (result.messages ?? []).filter(
      (m): m is RawMessage & { id: number } =>
        m != null && typeof m.id === 'number' && m.className === 'Message',
    );
    if (messages.length === 0) return;
    // Telegram returns descending by id; forward chronologically so the
    // destination order matches the source.
    messages.sort((a, b) => a.id - b.id);

    let enqueued = 0;
    let skippedDupes = 0;
    let highest = since;
    for (const msg of messages) {
      if (msg.id <= since) {
        // `minId` is exclusive on the server side, but be defensive.
        continue;
      }
      const sourceMessageId = String(msg.id);
      if (alreadyForwarded(sub.id, sourceMessageId)) {
        skippedDupes++;
        if (msg.id > highest) highest = msg.id;
        continue;
      }
      const job: RawForwardJob = {
        subscriptionId: sub.id,
        sourceChatId: sub.sourceChatId,
        destinationChatId: sub.destinationChatId,
        sourceMessageId,
        text: typeof msg.message === 'string' ? msg.message : '',
        hasMedia: msg.media != null,
        rawMessage: toJsonSafe(msg),
        ...(msg.groupedId
          ? { groupedId: (msg.groupedId as { toString(): string }).toString() }
          : {}),
      };
      forwarding.enqueue(job);
      enqueued++;
      if (msg.id > highest) highest = msg.id;
    }

    if (highest > since) {
      lastSeen.set(sub.id, highest);
    }
    if (enqueued > 0 || skippedDupes > 0) {
      logger.info(
        {
          subId: sub.id,
          sourceChatId: sub.sourceChatId,
          enqueued,
          skippedDupes,
          highestId: highest,
        },
        'history poller: sub sweep complete',
      );
    }
  }

  async function runSweep(): Promise<void> {
    const subs = selectSubs();
    let processed = 0;
    for (const sub of subs) {
      if (stopped) return;
      await pollOne(sub);
      processed++;
    }
    logger.debug({ processed }, 'history poller: full sweep complete');
  }

  async function poll(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      await inFlight;
      return;
    }
    inFlight = runSweep().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
  }

  return {
    start(): void {
      if (timer || stopped) return;
      // Kick off the first sweep immediately so we don't wait `intervalMs`
      // before catching the first batch on a fresh boot.
      void poll().catch((err) => {
        logger.error({ err }, 'history poller: initial sweep rejected');
      });
      timer = setInterval(() => {
        void poll().catch((err) => {
          logger.error({ err }, 'history poller: sweep rejected');
        });
      }, intervalMs);
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    poll,
  };
}
