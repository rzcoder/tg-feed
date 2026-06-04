// Safety net for the gramjs bug where the live listener silently stops delivering channel updates: polls getHistory(minId=lastSeen) per sub, dedups against forward_log.
import { eq, and } from 'drizzle-orm';
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { Db } from '../db/client.js';
import { destinations, forwardLog, subscriptions } from '../db/schema.js';
import { toJsonSafe } from '../lib/jsonSafe.js';
import type { Logger } from '../lib/logger.js';
import { createPoller } from '../lib/poller.js';
import { extractMessageEntities, type MessageEntityLike } from '../tg/entities.js';
import { extractRateLimit } from './floodwait.js';
import type { RawForwardingHandle, RawForwardJob } from './types.js';

export const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
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
  poll(): Promise<void>;
}

interface SubRow {
  id: number;
  sourceChatId: string;
  destinationChatId: string;
  destinationTopicId: string | null;
}

interface RawPeer {
  className?: string;
  userId?: { toString: () => string };
}

interface RawUser {
  className?: string;
  id?: { toString: () => string };
  username?: string;
}

interface RawMessage {
  id?: number;
  className?: string;
  message?: string;
  media?: unknown;
  groupedId?: { toString: () => string } | null;
  fromId?: RawPeer | null;
  entities?: MessageEntityLike[];
}

// GetHistory returns sender identity only via the response's users[]; build id→username (lowercased, like the live path).
function buildSenderMap(users: readonly RawUser[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of users ?? []) {
    if (
      u.className === 'User' &&
      u.id != null &&
      typeof u.username === 'string' &&
      u.username.length > 0
    ) {
      map.set(String(u.id), u.username.toLowerCase());
    }
  }
  return map;
}

function resolveSenderUsername(
  msg: RawMessage,
  senderMap: Map<string, string>,
): string | undefined {
  const from = msg.fromId;
  if (!from || from.className !== 'PeerUser' || from.userId == null) return undefined;
  return senderMap.get(String(from.userId));
}

export function createHistoryPoller(deps: HistoryPollerDeps): HistoryPoller {
  const { client, db, logger, forwarding } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lastSeen = new Map<number, number>();
  // Seeded lazily on first sweep, not at boot, to avoid hammering Telegram up front.
  const seeded = new Set<number>();
  let stopped = false;
  let inFlight: Promise<void> | undefined;

  function selectSubs(): SubRow[] {
    return db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        destinationChatId: destinations.chatId,
        destinationTopicId: destinations.topicId,
      })
      .from(subscriptions)
      .innerJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .where(eq(subscriptions.enabled, true))
      .all();
  }

  function maxLoggedId(subId: number): number | undefined {
    // source_message_id is text, so SQL MAX sorts lexicographically ('9' > '10'); reduce numerically in JS.
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
    // No history — seed from current top so we don't backfill the archive.
    try {
      const result = (await client.invoke(
        new Api.messages.GetHistory({
          peer: sub.sourceChatId,
          limit: 1,
        }),
      )) as { messages?: RawMessage[] };
      const topId = result.messages?.[0]?.id;
      // Empty channel: seed at 0 and mark seeded so we don't re-probe the top every tick.
      const seedId = typeof topId === 'number' ? topId : 0;
      lastSeen.set(sub.id, seedId);
      seeded.add(sub.id);
      logger.info(
        { subId: sub.id, sourceChatId: sub.sourceChatId, lastSeen: seedId },
        'history poller: seeded from channel top',
      );
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

    let result: { messages?: RawMessage[]; users?: RawUser[] };
    try {
      result = (await client.invoke(
        new Api.messages.GetHistory({
          peer: sub.sourceChatId,
          minId: since,
          limit: POLL_BATCH_LIMIT,
        }),
      )) as { messages?: RawMessage[]; users?: RawUser[] };
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
    // Telegram returns descending; forward ascending so destination order matches source.
    messages.sort((a, b) => a.id - b.id);
    const senderMap = buildSenderMap(result.users);

    let enqueued = 0;
    let skippedDupes = 0;
    let highest = since;
    for (const msg of messages) {
      if (msg.id <= since) {
        // minId is server-side exclusive, but be defensive.
        continue;
      }
      const sourceMessageId = String(msg.id);
      if (alreadyForwarded(sub.id, sourceMessageId)) {
        skippedDupes++;
        if (msg.id > highest) highest = msg.id;
        continue;
      }
      const text = typeof msg.message === 'string' ? msg.message : '';
      const { entityTexts, links } = extractMessageEntities(text, msg.entities);
      const senderUsername = resolveSenderUsername(msg, senderMap);
      const job: RawForwardJob = {
        subscriptionId: sub.id,
        sourceChatId: sub.sourceChatId,
        destinationChatId: sub.destinationChatId,
        destinationTopicId: sub.destinationTopicId,
        sourceMessageId,
        text,
        hasMedia: msg.media != null,
        entityTexts,
        links,
        rawMessage: toJsonSafe(msg),
        ...(msg.groupedId
          ? { groupedId: (msg.groupedId as { toString(): string }).toString() }
          : {}),
        ...(senderUsername !== undefined ? { senderUsername } : {}),
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

  const poller = createPoller({
    intervalMs,
    run: poll,
    logger,
    errorLogMessage: 'history poller: sweep rejected',
  });

  return {
    start: poller.start,
    stop(): void {
      stopped = true;
      poller.stop();
    },
    poll,
  };
}
