import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { ALBUM_DEBOUNCE_MS, createAlbumDebouncer } from './albumDebouncer.js';
import type { ForwardJob, ForwardingHandle, RawForwardJob } from './types.js';

const logger = createLogger({ silent: true });

function raw(overrides: Partial<RawForwardJob> = {}): RawForwardJob {
  return {
    subscriptionId: 1,
    sourceChatId: '-100SRC',
    destinationChatId: '-100DEST',
    sourceMessageId: '1',
    ...overrides,
  };
}

interface CapturingDownstream extends ForwardingHandle {
  jobs: ForwardJob[];
}

function makeDownstream(): CapturingDownstream {
  const jobs: ForwardJob[] = [];
  return {
    jobs,
    enqueue(job) {
      jobs.push(job);
    },
  };
}

describe('createAlbumDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through immediately when groupedId is absent', () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceMessageId: '7' }));

    expect(downstream.jobs).toHaveLength(1);
    expect(downstream.jobs[0]).toMatchObject({
      sourceChatId: '-100SRC',
      destinationChatId: '-100DEST',
      sourceMessageIds: ['7'],
    });
  });

  it('buffers messages sharing a groupedId and flushes one job after the window, sorted ascending', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceMessageId: '12', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '10', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '11', groupedId: 'g1' }));

    // Before the window expires: still buffered.
    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS - 1);
    expect(downstream.jobs).toHaveLength(0);

    // Window expires: one flush, ids sorted ascending.
    await vi.advanceTimersByTimeAsync(1);
    expect(downstream.jobs).toHaveLength(1);
    expect(downstream.jobs[0]?.sourceMessageIds).toEqual(['10', '11', '12']);
  });

  it('keys by sourceChatId so the same groupedId from two different chats does not conflate', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceChatId: '-100A', sourceMessageId: '1', groupedId: 'g' }));
    debouncer.enqueue(raw({ sourceChatId: '-100B', sourceMessageId: '2', groupedId: 'g' }));

    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);

    expect(downstream.jobs).toHaveLength(2);
    const bySource = new Map(downstream.jobs.map((j) => [j.sourceChatId, j.sourceMessageIds]));
    expect(bySource.get('-100A')).toEqual(['1']);
    expect(bySource.get('-100B')).toEqual(['2']);
  });

  it('treats a straggler arriving after the window as a new group', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceMessageId: '1', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '2', groupedId: 'g1' }));
    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);
    expect(downstream.jobs).toHaveLength(1);
    expect(downstream.jobs[0]?.sourceMessageIds).toEqual(['1', '2']);

    // Late member of the same album arrives after the flush — opens a new window.
    debouncer.enqueue(raw({ sourceMessageId: '3', groupedId: 'g1' }));
    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);
    expect(downstream.jobs).toHaveLength(2);
    expect(downstream.jobs[1]?.sourceMessageIds).toEqual(['3']);
  });

  it('dedupes identical source ids within a group', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceMessageId: '5', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '5', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '6', groupedId: 'g1' }));

    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);

    expect(downstream.jobs).toHaveLength(1);
    expect(downstream.jobs[0]?.sourceMessageIds).toEqual(['5', '6']);
  });

  it('stop() clears pending timers and ignores further enqueues', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({ downstream, logger });

    debouncer.enqueue(raw({ sourceMessageId: '1', groupedId: 'g1' }));
    debouncer.stop();

    // Pending group is dropped: advancing past the window must not flush.
    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS * 2);
    expect(downstream.jobs).toHaveLength(0);

    // Post-stop enqueues — pass-through and grouped both — are ignored.
    debouncer.enqueue(raw({ sourceMessageId: '2' }));
    debouncer.enqueue(raw({ sourceMessageId: '3', groupedId: 'g2' }));
    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS * 2);
    expect(downstream.jobs).toHaveLength(0);
  });
});
