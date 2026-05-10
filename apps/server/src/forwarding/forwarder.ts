/**
 * Single-shot forward + log writer.
 *
 * One call = one `forwardMessages` attempt + N `forward_log` rows (one per
 * source message id in `job.sourceMessageIds`). The worker in `queue.ts`
 * drives looping/retry; this module only knows how to perform one attempt and
 * record what happened.
 *
 * Returning a discriminated `ForwardOutcome` (instead of throwing) keeps the
 * worker loop free of error classification — the worker just switches on
 * `outcome.status`. Rate-limit errors (FLOOD_WAIT and SLOWMODE_WAIT) collapse
 * into one `flood_wait` outcome with a `kind` discriminator: retry semantics
 * are identical, but the diagnostic (log row + emitted event) preserves the
 * distinction. Permanent errors get a `failureKind` tag so the activity feed
 * can surface "this subscription will keep failing" vs "transient hiccup".
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog, subscriptions, type ForwardLogStatus } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import { extractRateLimit, type RateLimitKind } from './floodwait.js';
import type { ForwardFailureKind, ForwardJob, ForwardOutcome } from './types.js';

/**
 * Minimal structural slice of `TelegramClient.forwardMessages` we depend on.
 * Lets tests pass a `vi.fn()` instead of constructing a real client.
 *
 * `id` is intentionally optional and entries can be null/undefined: gramjs's
 * helper occasionally surfaces non-`Message` Updates entries (e.g. MessageEmpty,
 * service messages) that don't carry a numeric id. The forwarder filters those
 * out before stringifying — see comment at the call site.
 */
export interface ForwarderClient {
  forwardMessages(
    entity: string,
    params: { messages: number[]; fromPeer: string; silent?: boolean },
  ): Promise<ReadonlyArray<{ id?: number } | null | undefined>>;
}

export interface CreateForwarderDeps {
  client: ForwarderClient;
  db: Db;
  logger: Logger;
  bus: EventBus;
}

export type Forwarder = (job: ForwardJob) => Promise<ForwardOutcome>;

// Map known-permanent Telegram RPC error codes to our taxonomy. The strings
// are matched against err.message / err.errorMessage (gramjs surfaces the
// upstream code in there). Anything not on this list stays `transient`.
const PERMANENT_FAILURES: Array<{ code: string; kind: ForwardFailureKind }> = [
  { code: 'CHAT_FORWARDS_RESTRICTED', kind: 'permanent_chat_forwards_restricted' },
  { code: 'MESSAGE_ID_INVALID', kind: 'permanent_message_id_invalid' },
  { code: 'PEER_ID_INVALID', kind: 'permanent_peer_id_invalid' },
  { code: 'CHANNEL_PRIVATE', kind: 'permanent_channel_private' },
  { code: 'USER_BANNED_IN_CHANNEL', kind: 'permanent_user_banned_in_channel' },
  { code: 'CHAT_WRITE_FORBIDDEN', kind: 'permanent_chat_write_forbidden' },
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
    try {
      const sent = await client.forwardMessages(job.destinationChatId, {
        messages: messageIdNums,
        fromPeer: job.sourceChatId,
      });
      // gramjs's high-level helper sometimes surfaces non-`Message` entries
      // in the result (MessageEmpty, service updates, occasional null slots
      // when the server's Updates payload is sparse) — coerce defensively
      // and drop anything without a numeric id. Without the filter, calling
      // `.toString()` on `undefined.id` blows up the whole forward outcome
      // and we log a successful redirect as `failed`.
      const destMessageIds = sent
        .filter((m): m is { id: number } => m != null && typeof m.id === 'number')
        .map((m) => m.id.toString());
      if (destMessageIds.length !== job.sourceMessageIds.length) {
        // Telegram normally returns one id per forwarded message; a mismatch
        // means the upstream silently dropped some. The tail will be logged
        // as `sent` with destMessageId=NULL — flag it so it's investigable.
        logger.warn(
          {
            subscriptionId: job.subscriptionId,
            sourceCount: job.sourceMessageIds.length,
            destCount: destMessageIds.length,
          },
          'forward returned fewer dest ids than source ids',
        );
      }
      writeLogs(
        db,
        job,
        job.sourceMessageIds.map((sourceId, i) => ({
          sourceMessageId: sourceId,
          destMessageId: destMessageIds[i] ?? null,
        })),
        'sent',
        null,
      );
      // A successful forward proves the channel isn't (currently) restricting
      // forwards. Clear any sticky badge from a previous CHAT_FORWARDS_RESTRICTED.
      // The UPDATE is unconditional but cheap — single PK lookup, NULL→NULL
      // when nothing was set.
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
      });
      return { status: 'sent', destMessageIds };
    } catch (err) {
      const rateLimit = extractRateLimit(err);
      if (rateLimit) {
        return handleRateLimit(deps, job, rateLimit.seconds, rateLimit.kind);
      }
      const failureKind = classifyForwardError(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Tag permanent failures so the activity feed / log can render them
      // distinctly. Transient stays a bare message for backwards compatibility
      // with existing log readers.
      const errorText =
        failureKind === 'transient' ? errorMessage : `${failureKind}: ${errorMessage}`;
      if (failureKind === 'permanent_chat_forwards_restricted') {
        // Stamp the sticky badge so the UI can show "noforwards" until
        // either the channel re-allows forwards (cleared on the next
        // success) or the user disables / removes the subscription.
        db.update(subscriptions)
          .set({ forwardingRestrictedAt: new Date() })
          .where(eq(subscriptions.id, job.subscriptionId))
          .run();
      }
      writeLogs(
        db,
        job,
        job.sourceMessageIds.map((sourceId) => ({
          sourceMessageId: sourceId,
          destMessageId: null,
        })),
        'failed',
        errorText,
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
      });
      return { status: 'failed', error: errorText, failureKind };
    }
  };
}

function handleRateLimit(
  deps: CreateForwarderDeps,
  job: ForwardJob,
  seconds: number,
  kind: RateLimitKind,
): ForwardOutcome {
  const { db, logger, bus } = deps;
  const errorText = `${kind} ${seconds}s`;
  writeLogs(
    db,
    job,
    job.sourceMessageIds.map((sourceId) => ({
      sourceMessageId: sourceId,
      destMessageId: null,
    })),
    'flood_wait',
    errorText,
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
  });
  return { status: 'flood_wait', seconds, kind };
}

function writeLogs(
  db: Db,
  job: ForwardJob,
  rows: ReadonlyArray<{ sourceMessageId: string; destMessageId: string | null }>,
  status: ForwardLogStatus,
  error: string | null,
): void {
  if (rows.length === 0) return;
  db.insert(forwardLog)
    .values(
      rows.map((r) => ({
        subscriptionId: job.subscriptionId,
        sourceMessageId: r.sourceMessageId,
        destMessageId: r.destMessageId,
        status,
        error,
      })),
    )
    .run();
}
