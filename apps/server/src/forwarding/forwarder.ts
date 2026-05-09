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
 * `outcome.status`.
 */
import type { Db } from '../db/client.js';
import { forwardLog, type ForwardLogStatus } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import { isFloodWaitError } from './floodwait.js';
import type { ForwardJob, ForwardOutcome } from './types.js';

/**
 * Minimal structural slice of `TelegramClient.forwardMessages` we depend on.
 * Lets tests pass a `vi.fn()` instead of constructing a real client.
 */
export interface ForwarderClient {
  forwardMessages(
    entity: string,
    params: { messages: number[]; fromPeer: string; silent?: boolean },
  ): Promise<ReadonlyArray<{ id: number }>>;
}

export interface CreateForwarderDeps {
  client: ForwarderClient;
  db: Db;
  logger: Logger;
  bus: EventBus;
}

export type Forwarder = (job: ForwardJob) => Promise<ForwardOutcome>;

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
      const destMessageIds = sent.map((m) => m.id.toString());
      job.sourceMessageIds.forEach((sourceId, i) => {
        writeLog(db, job, sourceId, 'sent', destMessageIds[i] ?? null, null);
      });
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
      if (isFloodWaitError(err)) {
        const errorText = `flood_wait ${err.seconds}s`;
        job.sourceMessageIds.forEach((sourceId) => {
          writeLog(db, job, sourceId, 'flood_wait', null, errorText);
        });
        logger.warn(
          {
            subscriptionId: job.subscriptionId,
            destinationChatId: job.destinationChatId,
            sourceMessageIds: job.sourceMessageIds,
            seconds: err.seconds,
          },
          'forward hit flood wait',
        );
        bus.emit({
          type: 'forward.flood_wait',
          subscriptionId: job.subscriptionId,
          sourceChatId: job.sourceChatId,
          destinationChatId: job.destinationChatId,
          sourceMessageIds: [...job.sourceMessageIds],
          seconds: err.seconds,
        });
        return { status: 'flood_wait', seconds: err.seconds };
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      job.sourceMessageIds.forEach((sourceId) => {
        writeLog(db, job, sourceId, 'failed', null, errorMessage);
      });
      logger.error(
        {
          subscriptionId: job.subscriptionId,
          destinationChatId: job.destinationChatId,
          sourceMessageIds: job.sourceMessageIds,
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
        error: errorMessage,
      });
      return { status: 'failed', error: errorMessage };
    }
  };
}

function writeLog(
  db: Db,
  job: ForwardJob,
  sourceMessageId: string,
  status: ForwardLogStatus,
  destMessageId: string | null,
  error: string | null,
): void {
  db.insert(forwardLog)
    .values({
      subscriptionId: job.subscriptionId,
      sourceMessageId,
      destMessageId,
      status,
      error,
    })
    .run();
}
