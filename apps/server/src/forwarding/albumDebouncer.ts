// Albums arrive as N NewMessage events sharing a groupedId; buffer per `${subscriptionId}:${groupedId}` to forward+filter as one (per-sub so a fan-out source keeps each subscription's album separate).
import type { FilterEvaluator } from '../filters/evaluate.js';
import type { MessageContext } from '../filters/types.js';
import type { Logger } from '../lib/logger.js';
import type { ForwardJob, ForwardingHandle, RawForwardJob, RawForwardingHandle } from './types.js';

interface PendingGroup {
  jobs: RawForwardJob[];
  timer: ReturnType<typeof setTimeout>;
}

export interface AlbumDebouncerDeps {
  downstream: ForwardingHandle;
  filterEvaluator: FilterEvaluator;
  logger: Logger;
  // Read per-album so a Settings change to the window takes effect without a restart.
  getWindowMs: () => number;
}

export interface AlbumDebouncer extends RawForwardingHandle {
  stop(): void;
}

export function createAlbumDebouncer(deps: AlbumDebouncerDeps): AlbumDebouncer {
  const { downstream, filterEvaluator, logger, getWindowMs } = deps;
  const pending = new Map<string, PendingGroup>();
  let stopped = false;

  function flush(key: string): void {
    const group = pending.get(key);
    if (!group) return;
    pending.delete(key);

    const first = group.jobs[0]!;
    const sourceMessageIds = dedupeAndSort(group.jobs.map((j) => j.sourceMessageId));
    const captionMember = pickCaptionBearingMember(group.jobs);
    // Aligned 1:1 with sourceMessageIds; stored on every album row so any row can stand alone.
    const albumRawMessage = collectAlbumRawMessages(group.jobs, sourceMessageIds);
    const context: MessageContext = {
      ...toContext(captionMember),
      rawMessage: albumRawMessage,
    };

    const { pass } = filterEvaluator.evaluate(context, first.subscriptionId, sourceMessageIds);
    if (!pass) return;

    const job: ForwardJob = {
      subscriptionId: first.subscriptionId,
      sourceChatId: first.sourceChatId,
      destinationChatId: first.destinationChatId,
      destinationTopicId: first.destinationTopicId ?? null,
      sourceMessageIds,
      rawMessage: albumRawMessage,
    };

    logger.info(
      {
        sourceChatId: first.sourceChatId,
        groupedId: first.groupedId,
        count: sourceMessageIds.length,
      },
      'album flushed',
    );
    downstream.enqueue(job);
  }

  return {
    enqueue(raw: RawForwardJob): void {
      if (stopped) return;

      if (raw.groupedId === undefined) {
        const { pass } = filterEvaluator.evaluate(toContext(raw), raw.subscriptionId, [
          raw.sourceMessageId,
        ]);
        if (!pass) return;
        downstream.enqueue({
          subscriptionId: raw.subscriptionId,
          sourceChatId: raw.sourceChatId,
          destinationChatId: raw.destinationChatId,
          destinationTopicId: raw.destinationTopicId ?? null,
          sourceMessageIds: [raw.sourceMessageId],
          rawMessage: raw.rawMessage ?? null,
        });
        return;
      }

      const key = `${raw.subscriptionId}:${raw.groupedId}`;
      const existing = pending.get(key);
      if (existing) {
        existing.jobs.push(raw);
        return;
      }

      const timer = setTimeout(() => flush(key), getWindowMs());
      pending.set(key, { jobs: [raw], timer });
    },

    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const group of pending.values()) {
        clearTimeout(group.timer);
      }
      pending.clear();
    },
  };
}

function dedupeAndSort(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
}

function toContext(job: RawForwardJob): MessageContext {
  return {
    text: job.text,
    hasMedia: job.hasMedia,
    rawMessage: job.rawMessage ?? null,
    ...(job.senderUsername !== undefined ? { senderUsername: job.senderUsername } : {}),
  };
}

// Aligned 1:1 with sourceMessageIds; dup ids collapse to first, missing → null.
function collectAlbumRawMessages(
  jobs: readonly RawForwardJob[],
  sourceMessageIds: readonly string[],
): unknown[] {
  const bySourceId = new Map<string, unknown>();
  for (const j of jobs) {
    if (!bySourceId.has(j.sourceMessageId)) {
      bySourceId.set(j.sourceMessageId, j.rawMessage ?? null);
    }
  }
  return sourceMessageIds.map((id) => bySourceId.get(id) ?? null);
}

// Telegram puts the caption on one member: pick longest text, ties to lowest message id.
function pickCaptionBearingMember(jobs: readonly RawForwardJob[]): RawForwardJob {
  let best = jobs[0]!;
  for (const candidate of jobs.slice(1)) {
    if (candidate.text.length > best.text.length) {
      best = candidate;
    } else if (
      candidate.text.length === best.text.length &&
      Number(candidate.sourceMessageId) < Number(best.sourceMessageId)
    ) {
      best = candidate;
    }
  }
  return best;
}
