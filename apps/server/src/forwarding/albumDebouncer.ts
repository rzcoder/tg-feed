/**
 * Album / grouped-media debouncer.
 *
 * Telegram delivers album members (photos/videos sharing a `groupedId`) as N
 * independent `NewMessage` events arriving milliseconds apart. Without
 * debouncing they would be forwarded as N separate messages — fragmenting the
 * album in the destination and burning N throttle slots.
 *
 * This module sits between the listener (which produces one `RawForwardJob`
 * per event) and the per-destination pipeline (which consumes one
 * `ForwardJob` carrying the full id list). For ungrouped messages the
 * debouncer is a pure pass-through. For grouped messages it buffers by
 * `${sourceChatId}:${groupedId}` for `ALBUM_DEBOUNCE_MS` and flushes the
 * collected ids — sorted ascending and de-duplicated — as one `ForwardJob`.
 *
 * `stop()` cancels pending timers and drops their buffered jobs (matches the
 * pipeline's "ignore enqueue after stop" behavior in `queue.ts`). The
 * listener doesn't persist incoming messages anywhere, so a missed album
 * member at shutdown is no different from any other miss while offline.
 */
import type { Logger } from '../lib/logger.js';
import type { ForwardJob, ForwardingHandle, RawForwardJob, RawForwardingHandle } from './types.js';

export const ALBUM_DEBOUNCE_MS = 2000;

interface PendingGroup {
  jobs: RawForwardJob[];
  timer: ReturnType<typeof setTimeout>;
}

export interface AlbumDebouncerDeps {
  downstream: ForwardingHandle;
  logger: Logger;
  windowMs?: number;
}

export interface AlbumDebouncer extends RawForwardingHandle {
  stop(): void;
}

export function createAlbumDebouncer(deps: AlbumDebouncerDeps): AlbumDebouncer {
  const { downstream, logger } = deps;
  const windowMs = deps.windowMs ?? ALBUM_DEBOUNCE_MS;
  const pending = new Map<string, PendingGroup>();
  let stopped = false;

  function flush(key: string): void {
    const group = pending.get(key);
    if (!group) return;
    pending.delete(key);

    const first = group.jobs[0]!;
    const sourceMessageIds = dedupeAndSort(group.jobs.map((j) => j.sourceMessageId));
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

      const timer = setTimeout(() => flush(key), windowMs);
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
