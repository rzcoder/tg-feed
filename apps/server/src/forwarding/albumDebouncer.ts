/**
 * Album / grouped-media debouncer + filter gate.
 *
 * Telegram delivers album members (photos/videos sharing a `groupedId`) as N
 * independent `NewMessage` events arriving milliseconds apart. Without
 * debouncing they would be forwarded as N separate messages — fragmenting the
 * album in the destination and burning N throttle slots.
 *
 * This module sits between the listener (which produces one `RawForwardJob`
 * per event) and the per-destination pipeline (which consumes one
 * `ForwardJob` carrying the full id list). For ungrouped messages the
 * debouncer evaluates filters and either passes the job through or drops it.
 * For grouped messages it buffers by `${sourceChatId}:${groupedId}` for
 * `ALBUM_DEBOUNCE_MS`, picks the caption-bearing member at flush time
 * (longest text; ties broken by lowest message id), and evaluates filters
 * once against that member's content — so an album passes or fails as a
 * unit. Source ids in the emitted `ForwardJob` are sorted ascending and
 * de-duplicated.
 *
 * On filter rejection the evaluator writes one `forward_log` row per source
 * id with `status='filtered'` and the joined reasons in `error`. The
 * debouncer itself never touches `forward_log`.
 *
 * `stop()` cancels pending timers and drops their buffered jobs (matches the
 * pipeline's "ignore enqueue after stop" behavior in `queue.ts`). The
 * listener doesn't persist incoming messages anywhere, so a missed album
 * member at shutdown is no different from any other miss while offline.
 */
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
  /**
   * Live-reads the debounce window from app_settings on each new album.
   * Wired up to `getAlbumDebounceMs(db)` in production; tests pass a
   * constant. Read per-album rather than per-debouncer so the Settings
   * UI takes effect on the next album without a restart.
   */
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
    const context = toContext(captionMember);

    const { pass } = filterEvaluator.evaluate(context, first.subscriptionId, sourceMessageIds);
    if (!pass) return;

    const job: ForwardJob = {
      subscriptionId: first.subscriptionId,
      sourceChatId: first.sourceChatId,
      destinationChatId: first.destinationChatId,
      sourceMessageIds,
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
          sourceMessageIds: [raw.sourceMessageId],
        });
        return;
      }

      const key = `${raw.sourceChatId}:${raw.groupedId}`;
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
    ...(job.senderUsername !== undefined ? { senderUsername: job.senderUsername } : {}),
  };
}

/**
 * Telegram puts the caption on a single album member (typically the first by
 * message id). Pick the longest-text member; ties go to the lowest message id
 * for determinism. Falls back to the first job if all members have empty text.
 */
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
