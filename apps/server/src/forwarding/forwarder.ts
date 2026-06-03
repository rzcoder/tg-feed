import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog, subscriptions, type ForwardLogStatus } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import { extractRateLimit, type RateLimitKind } from './floodwait.js';
import type { ForwardFailureKind, ForwardJob, ForwardOutcome } from './types.js';

export interface ForwarderClient {
  forwardMessages(
    entity: string,
    params: { messages: number[]; fromPeer: string; silent?: boolean; topMsgId?: number },
  ): Promise<ReadonlyArray<{ id?: number } | null | undefined>>;
}

export interface CreateForwarderDeps {
  client: ForwarderClient;
  db: Db;
  logger: Logger;
  bus: EventBus;
}

export type Forwarder = (job: ForwardJob) => Promise<ForwardOutcome>;

// Matched against err.message/err.errorMessage; anything not listed stays `transient`.
const PERMANENT_FAILURES: Array<{ code: string; kind: ForwardFailureKind }> = [
  { code: 'CHAT_FORWARDS_RESTRICTED', kind: 'permanent_chat_forwards_restricted' },
  { code: 'MESSAGE_ID_INVALID', kind: 'permanent_message_id_invalid' },
  { code: 'PEER_ID_INVALID', kind: 'permanent_peer_id_invalid' },
  { code: 'CHANNEL_PRIVATE', kind: 'permanent_channel_private' },
  { code: 'USER_BANNED_IN_CHANNEL', kind: 'permanent_user_banned_in_channel' },
  { code: 'CHAT_WRITE_FORBIDDEN', kind: 'permanent_chat_write_forbidden' },
  // Stale destination topicId; won't recover until re-pointed at a live topic.
  { code: 'TOPIC_CLOSED', kind: 'permanent_topic_unavailable' },
  { code: 'TOPIC_DELETED', kind: 'permanent_topic_unavailable' },
  { code: 'TOPIC_ID_INVALID', kind: 'permanent_topic_unavailable' },
  { code: 'AUTH_KEY_UNREGISTERED', kind: 'fatal_auth_key_unregistered' },
];

export function classifyForwardError(err: unknown): ForwardFailureKind {
  if (typeof err !== 'object' || err === null) return 'transient';
  const e = err as { errorMessage?: string; message?: string };
  const msg = (e.errorMessage ?? e.message ?? '').toUpperCase();
  if (!msg) return 'transient';
  for (const entry of PERMANENT_FAILURES) {
    if (msg.includes(entry.code)) return entry.kind;
  }
  return 'transient';
}

export function createForwarder(deps: CreateForwarderDeps): Forwarder {
  const { client, db, logger, bus } = deps;

  return async (job: ForwardJob): Promise<ForwardOutcome> => {
    const messageIdNums = job.sourceMessageIds.map((id) => Number(id));
    bus.emit({
      type: 'forward.started',
      subscriptionId: job.subscriptionId,
      sourceChatId: job.sourceChatId,
      destinationChatId: job.destinationChatId,
      sourceMessageIds: [...job.sourceMessageIds],
    });
    const rawMessage = job.rawMessage ?? null;
    try {
      const sent = await client.forwardMessages(job.destinationChatId, {
        messages: messageIdNums,
        fromPeer: job.sourceChatId,
        ...(job.destinationTopicId != null ? { topMsgId: Number(job.destinationTopicId) } : {}),
      });
      // Drop non-`Message` result entries (MessageEmpty/service/null) with no numeric id, else `.toString()` throws and a success logs as `failed`.
      const destMessageIds = sent
        .filter((m): m is { id: number } => m != null && typeof m.id === 'number')
        .map((m) => m.id.toString());
      if (destMessageIds.length !== job.sourceMessageIds.length) {
        // Mismatch = upstream silently dropped some; the tail logs `sent` with destMessageId=NULL.
        logger.warn(
          {
            subscriptionId: job.subscriptionId,
            sourceCount: job.sourceMessageIds.length,
            destCount: destMessageIds.length,
          },
          'forward returned fewer dest ids than source ids',
        );
      }
      const forwardLogIds = writeLogs(
        db,
        job,
        job.sourceMessageIds.map((sourceId, i) => ({
          sourceMessageId: sourceId,
          destMessageId: destMessageIds[i] ?? null,
        })),
        'sent',
        null,
        rawMessage,
      );
      // Success proves forwards aren't restricted; clear any sticky CHAT_FORWARDS_RESTRICTED badge.
      db.update(subscriptions)
        .set({ forwardingRestrictedAt: null })
        .where(eq(subscriptions.id, job.subscriptionId))
        .run();
      logger.info(
        {
          subscriptionId: job.subscriptionId,
          sourceChatId: job.sourceChatId,
          destinationChatId: job.destinationChatId,
          sourceMessageIds: job.sourceMessageIds,
          destMessageIds,
        },
        'forward sent',
      );
      bus.emit({
        type: 'forward.completed',
        subscriptionId: job.subscriptionId,
        sourceChatId: job.sourceChatId,
        destinationChatId: job.destinationChatId,
        sourceMessageIds: [...job.sourceMessageIds],
        destMessageIds,
        forwardLogIds,
      });
      return { status: 'sent', destMessageIds };
    } catch (err) {
      const rateLimit = extractRateLimit(err);
      if (rateLimit) {
        return handleRateLimit(deps, job, rateLimit.seconds, rateLimit.kind);
      }
      const failureKind = classifyForwardError(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Tag permanent failures; transient stays a bare message for existing log readers.
      const errorText =
        failureKind === 'transient' ? errorMessage : `${failureKind}: ${errorMessage}`;
      if (failureKind === 'permanent_chat_forwards_restricted') {
        // Sticky "noforwards" badge, cleared on the next successful forward.
        db.update(subscriptions)
          .set({ forwardingRestrictedAt: new Date() })
          .where(eq(subscriptions.id, job.subscriptionId))
          .run();
      }
      const forwardLogIds = writeLogs(
        db,
        job,
        job.sourceMessageIds.map((sourceId) => ({
          sourceMessageId: sourceId,
          destMessageId: null,
        })),
        'failed',
        errorText,
        rawMessage,
      );
      const logFn =
        failureKind === 'transient' ? logger.error.bind(logger) : logger.warn.bind(logger);
      logFn(
        {
          subscriptionId: job.subscriptionId,
          destinationChatId: job.destinationChatId,
          sourceMessageIds: job.sourceMessageIds,
          failureKind,
          err,
        },
        'forward failed',
      );
      bus.emit({
        type: 'forward.failed',
        subscriptionId: job.subscriptionId,
        sourceChatId: job.sourceChatId,
        destinationChatId: job.destinationChatId,
        sourceMessageIds: [...job.sourceMessageIds],
        error: errorText,
        forwardLogIds,
      });
      return { status: 'failed', error: errorText, failureKind };
    }
  };
}

// Record a terminal failure for a job (e.g. a dead-lettered flood_wait): a `failed`
// forward_log row + a `forward.failed` event, reusing the normal failure surfacing.
export function recordForwardFailure(
  deps: Pick<CreateForwarderDeps, 'db' | 'logger' | 'bus'>,
  job: ForwardJob,
  errorText: string,
): void {
  const { db, logger, bus } = deps;
  const forwardLogIds = writeLogs(
    db,
    job,
    job.sourceMessageIds.map((sourceId) => ({ sourceMessageId: sourceId, destMessageId: null })),
    'failed',
    errorText,
    job.rawMessage ?? null,
  );
  logger.warn(
    {
      subscriptionId: job.subscriptionId,
      destinationChatId: job.destinationChatId,
      sourceMessageIds: job.sourceMessageIds,
      error: errorText,
    },
    'forward dead-lettered',
  );
  bus.emit({
    type: 'forward.failed',
    subscriptionId: job.subscriptionId,
    sourceChatId: job.sourceChatId,
    destinationChatId: job.destinationChatId,
    sourceMessageIds: [...job.sourceMessageIds],
    error: errorText,
    forwardLogIds,
  });
}

function handleRateLimit(
  deps: CreateForwarderDeps,
  job: ForwardJob,
  seconds: number,
  kind: RateLimitKind,
): ForwardOutcome {
  const { db, logger, bus } = deps;
  const errorText = `${kind} ${seconds}s`;
  const forwardLogIds = writeLogs(
    db,
    job,
    job.sourceMessageIds.map((sourceId) => ({
      sourceMessageId: sourceId,
      destMessageId: null,
    })),
    'flood_wait',
    errorText,
    job.rawMessage ?? null,
  );
  logger.warn(
    {
      subscriptionId: job.subscriptionId,
      destinationChatId: job.destinationChatId,
      sourceMessageIds: job.sourceMessageIds,
      seconds,
      kind,
    },
    'forward hit rate limit',
  );
  bus.emit({
    type: 'forward.flood_wait',
    subscriptionId: job.subscriptionId,
    sourceChatId: job.sourceChatId,
    destinationChatId: job.destinationChatId,
    sourceMessageIds: [...job.sourceMessageIds],
    seconds,
    forwardLogIds,
  });
  return { status: 'flood_wait', seconds, kind };
}

// Second wall behind `toJsonSafe`'s 64KB truncation in case a large nested payload slips through.
const RAW_MESSAGE_MAX_BYTES = 128 * 1024;

// Over-limit snapshots become a truncation marker so the row still inserts.
function clampRawMessage(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return null;
  }
  if (encoded === undefined) return null;
  const byteLen = Buffer.byteLength(encoded, 'utf8');
  if (byteLen <= RAW_MESSAGE_MAX_BYTES) return value;
  return { __truncated: true, size: byteLen };
}

// The batch's single rawMessage is denormalized onto every row so any row is inspectable via GET /forward-log/:id/raw.
function writeLogs(
  db: Db,
  job: ForwardJob,
  rows: ReadonlyArray<{ sourceMessageId: string; destMessageId: string | null }>,
  status: ForwardLogStatus,
  error: string | null,
  rawMessage: unknown,
): number[] {
  if (rows.length === 0) return [];
  const safeRaw = clampRawMessage(rawMessage);
  const inserted = db
    .insert(forwardLog)
    .values(
      rows.map((r) => ({
        subscriptionId: job.subscriptionId,
        sourceMessageId: r.sourceMessageId,
        destMessageId: r.destMessageId,
        status,
        error,
        rawMessage: safeRaw,
      })),
    )
    .returning({ id: forwardLog.id })
    .all();
  return inserted.map((row) => row.id);
}
