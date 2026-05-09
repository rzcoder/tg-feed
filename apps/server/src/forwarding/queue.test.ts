import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import type { Forwarder } from './forwarder.js';
import { ForwardingPipeline, type SleepFn } from './queue.js';
import type { ForwardJob, ForwardOutcome } from './types.js';

const logger = createLogger({ silent: true });

function job(destinationChatId: string, sourceMessageId: string): ForwardJob {
  return {
    subscriptionId: 1,
    sourceChatId: '-100SRC',
    destinationChatId,
    sourceMessageIds: [sourceMessageId],
  };
}

const sent = (id = '1'): ForwardOutcome => ({ status: 'sent', destMessageIds: [id] });

/**
 * Sleep that uses fake timers' setTimeout — `vi.advanceTimersByTimeAsync`
 * fires it and flushes microtasks, which is exactly what we want for the
 * worker loop's `await sleep` continuations.
 */
const fakeSleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

describe('ForwardingPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains a single destination FIFO in order, throttled by delayMs between sends', async () => {
    const order: string[] = [];
    const sendTimes: number[] = [];
    const forwarder: Forwarder = vi.fn(async (j) => {
      order.push(j.sourceMessageIds[0]!);
      sendTimes.push(Date.now());
      return sent();
    });

    const pipeline = new ForwardingPipeline({
      forwarder,
      getDelayMs: () => 1000,
      logger,
      sleep: fakeSleep,
    });

    pipeline.enqueue(job('-100A', '1'));
    pipeline.enqueue(job('-100A', '2'));
    pipeline.enqueue(job('-100A', '3'));

    // First send happens without throttle (lastSendAt === 0).
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['1']);

    // Second send: must wait 1000 ms.
    await vi.advanceTimersByTimeAsync(999);
    expect(order).toEqual(['1']);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['1', '2']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['1', '2', '3']);

    expect(sendTimes[1]! - sendTimes[0]!).toBe(1000);
    expect(sendTimes[2]! - sendTimes[1]!).toBe(1000);

    await pipeline.stop();
  });

  it('drains parallel destinations independently — second destination does not wait for first', async () => {
    const events: string[] = [];
    const forwarder: Forwarder = vi.fn(async (j) => {
      events.push(`${j.destinationChatId}:${j.sourceMessageIds[0]!}`);
      return sent();
    });

    const pipeline = new ForwardingPipeline({
      forwarder,
      getDelayMs: () => 5000,
      logger,
      sleep: fakeSleep,
    });

    pipeline.enqueue(job('-100A', '1'));
    pipeline.enqueue(job('-100B', '1'));

    await vi.advanceTimersByTimeAsync(0);
    expect(events.sort()).toEqual(['-100A:1', '-100B:1']);

    await pipeline.stop();
  });

  it('on flood_wait outcome: sleeps seconds*1000 and retries the same job', async () => {
    let callCount = 0;
    const forwarder: Forwarder = vi.fn(async (j): Promise<ForwardOutcome> => {
      callCount++;
      if (callCount === 1) return { status: 'flood_wait', seconds: 30 };
      return { status: 'sent', destMessageIds: [`fwd-${j.sourceMessageIds[0]!}`] };
    });

    const pipeline = new ForwardingPipeline({
      forwarder,
      getDelayMs: () => 1000,
      logger,
      sleep: fakeSleep,
    });

    pipeline.enqueue(job('-100A', 'msg-1'));
    pipeline.enqueue(job('-100A', 'msg-2'));

    // First attempt fires immediately, hits flood_wait.
    await vi.advanceTimersByTimeAsync(0);
    expect(forwarder).toHaveBeenCalledTimes(1);
    expect(forwarder).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceMessageIds: ['msg-1'] }),
    );

    // Halfway through the flood backoff: still waiting.
    await vi.advanceTimersByTimeAsync(15000);
    expect(forwarder).toHaveBeenCalledTimes(1);

    // Backoff complete: retry the SAME job.
    await vi.advanceTimersByTimeAsync(15000);
    expect(forwarder).toHaveBeenCalledTimes(2);
    expect(forwarder).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceMessageIds: ['msg-1'] }),
    );

    // Then the throttle delay before the next job fires.
    await vi.advanceTimersByTimeAsync(1000);
    expect(forwarder).toHaveBeenCalledTimes(3);
    expect(forwarder).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceMessageIds: ['msg-2'] }),
    );

    await pipeline.stop();
  });

  it('stop() aborts a pending throttle sleep and resolves promptly', async () => {
    const forwarder: Forwarder = vi.fn(async () => sent());
    const pipeline = new ForwardingPipeline({
      forwarder,
      getDelayMs: () => 60_000, // huge delay — would block forever without abort
      logger,
      sleep: fakeSleep,
    });

    pipeline.enqueue(job('-100A', '1'));
    pipeline.enqueue(job('-100A', '2'));

    // First send fires; second is parked in the throttle sleep.
    await vi.advanceTimersByTimeAsync(0);
    expect(forwarder).toHaveBeenCalledTimes(1);

    // Stop without advancing the 60s timer — the abort must wake the sleep.
    await expect(pipeline.stop()).resolves.toBeUndefined();
    expect(forwarder).toHaveBeenCalledTimes(1);
  });

  it('ignores enqueue after stop', async () => {
    const forwarder: Forwarder = vi.fn(async () => sent());
    const pipeline = new ForwardingPipeline({
      forwarder,
      getDelayMs: () => 1000,
      logger,
      sleep: fakeSleep,
    });

    await pipeline.stop();
    pipeline.enqueue(job('-100A', '1'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forwarder).not.toHaveBeenCalled();
  });
});
