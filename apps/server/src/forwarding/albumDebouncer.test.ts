import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FilterEvaluator } from '../filters/evaluate.js';
import type { MessageContext } from '../filters/types.js';
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
    text: '',
    hasMedia: false,
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

const passEvaluator: FilterEvaluator = {
  evaluate: () => ({ pass: true }),
};

interface FilterCall {
  context: MessageContext;
  subscriptionId: number;
  sourceMessageIds: readonly string[];
}

function captureEvaluator(pass: boolean): {
  evaluator: FilterEvaluator;
  calls: FilterCall[];
} {
  const calls: FilterCall[] = [];
  return {
    calls,
    evaluator: {
      evaluate(context, subscriptionId, sourceMessageIds) {
        calls.push({ context, subscriptionId, sourceMessageIds });
        return { pass };
      },
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
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

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
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

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
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

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
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

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
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

    debouncer.enqueue(raw({ sourceMessageId: '5', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '5', groupedId: 'g1' }));
    debouncer.enqueue(raw({ sourceMessageId: '6', groupedId: 'g1' }));

    await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);

    expect(downstream.jobs).toHaveLength(1);
    expect(downstream.jobs[0]?.sourceMessageIds).toEqual(['5', '6']);
  });

  it('stop() clears pending timers and ignores further enqueues', async () => {
    const downstream = makeDownstream();
    const debouncer = createAlbumDebouncer({
      downstream,
      filterEvaluator: passEvaluator,
      logger,
    });

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

  describe('filter integration', () => {
    it('drops the job and skips downstream when filter rejects an ungrouped message', () => {
      const downstream = makeDownstream();
      const { evaluator, calls } = captureEvaluator(false);
      const debouncer = createAlbumDebouncer({
        downstream,
        filterEvaluator: evaluator,
        logger,
      });

      debouncer.enqueue(
        raw({
          subscriptionId: 42,
          sourceMessageId: '7',
          text: 'hello',
          hasMedia: true,
          senderUsername: 'alice',
        }),
      );

      expect(downstream.jobs).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        context: { text: 'hello', hasMedia: true, senderUsername: 'alice' },
        subscriptionId: 42,
        sourceMessageIds: ['7'],
      });
    });

    it('passes ungrouped message through when filter accepts', () => {
      const downstream = makeDownstream();
      const { evaluator, calls } = captureEvaluator(true);
      const debouncer = createAlbumDebouncer({
        downstream,
        filterEvaluator: evaluator,
        logger,
      });

      debouncer.enqueue(raw({ sourceMessageId: '7', text: 'hi' }));

      expect(downstream.jobs).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.context.text).toBe('hi');
    });

    it('drops the whole album when filter rejects, evaluating against caption-bearing member', async () => {
      const downstream = makeDownstream();
      const { evaluator, calls } = captureEvaluator(false);
      const debouncer = createAlbumDebouncer({
        downstream,
        filterEvaluator: evaluator,
        logger,
      });

      // Three album members; only message 11 carries the caption.
      debouncer.enqueue(
        raw({ subscriptionId: 9, sourceMessageId: '12', groupedId: 'g1', text: '' }),
      );
      debouncer.enqueue(
        raw({
          subscriptionId: 9,
          sourceMessageId: '11',
          groupedId: 'g1',
          text: 'this is the caption',
        }),
      );
      debouncer.enqueue(
        raw({ subscriptionId: 9, sourceMessageId: '13', groupedId: 'g1', text: '' }),
      );

      await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);

      expect(downstream.jobs).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.context.text).toBe('this is the caption');
      expect(calls[0]?.subscriptionId).toBe(9);
      expect([...calls[0]!.sourceMessageIds]).toEqual(['11', '12', '13']);
    });

    it('emits the album when filter accepts, with all member ids', async () => {
      const downstream = makeDownstream();
      const { evaluator, calls } = captureEvaluator(true);
      const debouncer = createAlbumDebouncer({
        downstream,
        filterEvaluator: evaluator,
        logger,
      });

      debouncer.enqueue(raw({ sourceMessageId: '20', groupedId: 'g1', text: 'caption' }));
      debouncer.enqueue(raw({ sourceMessageId: '21', groupedId: 'g1' }));

      await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS);

      expect(downstream.jobs).toHaveLength(1);
      expect(downstream.jobs[0]?.sourceMessageIds).toEqual(['20', '21']);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.context.text).toBe('caption');
    });
  });
});
