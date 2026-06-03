// Per-destination FIFO + worker: Telegram throttles per receiving chat, so that's the throttling domain.
import { setTimeout as nodeSleep } from 'node:timers/promises';
import type { Logger } from '../lib/logger.js';
import type { Forwarder } from './forwarder.js';
import type { ForwardJob, ForwardingHandle } from './types.js';

export const MAX_FLOOD_WAIT_SECONDS = 300;
// Consecutive flood_waits on one head job before it's dead-lettered (and the FIFO unblocked).
export const MAX_FLOOD_WAIT_ATTEMPTS = 5;

export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

export const cancellableSleep: SleepFn = (ms, signal) =>
  nodeSleep(ms, undefined, { signal }).catch(() => undefined);

export interface PipelineDeps {
  forwarder: Forwarder;
  getDelayMs: () => number;
  logger: Logger;
  sleep?: SleepFn;
  // Called when a job is abandoned after MAX_FLOOD_WAIT_ATTEMPTS; records the terminal failure.
  onDeadLetter?: (job: ForwardJob) => void;
}

interface WorkerDeps {
  forwarder: Forwarder;
  getDelayMs: () => number;
  logger: Logger;
  sleep: SleepFn;
  onDeadLetter?: (job: ForwardJob) => void;
}

class DestinationWorker {
  private readonly queue: ForwardJob[] = [];
  private wakeup: () => void = () => {};
  private wakeupPromise: Promise<void>;
  private lastSendAt = 0;
  private floodWaitCount = 0;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly destinationChatId: string,
    private readonly deps: WorkerDeps,
    private readonly signal: AbortSignal,
  ) {
    this.wakeupPromise = this.makeWakeup();
  }

  enqueue(job: ForwardJob): void {
    this.queue.push(job);
    this.wakeup();
  }

  start(): void {
    if (!this.loopPromise) this.loopPromise = this.run();
  }

  async stop(): Promise<void> {
    this.wakeup();
    if (this.loopPromise) await this.loopPromise;
  }

  private makeWakeup(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wakeup = resolve;
    });
  }

  private async run(): Promise<void> {
    while (!this.signal.aborted) {
      if (this.queue.length === 0) {
        await this.wakeupPromise;
        this.wakeupPromise = this.makeWakeup();
        if (this.signal.aborted) break;
        if (this.queue.length === 0) continue;
      }

      if (this.lastSendAt > 0) {
        const delay = this.deps.getDelayMs();
        const elapsed = Date.now() - this.lastSendAt;
        const wait = delay - elapsed;
        if (wait > 0) {
          await this.deps.sleep(wait, this.signal);
          if (this.signal.aborted) break;
        }
      }

      const job = this.queue[0]!;
      const outcome = await this.deps.forwarder(job);

      if (outcome.status === 'flood_wait') {
        this.floodWaitCount++;
        if (this.floodWaitCount > MAX_FLOOD_WAIT_ATTEMPTS) {
          // Perpetually flooded — abandon the head job so it can't wedge the FIFO forever.
          this.deps.logger.error(
            {
              destinationChatId: this.destinationChatId,
              sourceMessageIds: job.sourceMessageIds,
              attempts: this.floodWaitCount,
            },
            'flood_wait exceeded max attempts — dead-lettering job',
          );
          this.deps.onDeadLetter?.(job);
          this.queue.shift();
          this.floodWaitCount = 0;
          continue;
        }
        const cappedSeconds = Math.min(outcome.seconds, MAX_FLOOD_WAIT_SECONDS);
        if (outcome.seconds > MAX_FLOOD_WAIT_SECONDS) {
          this.deps.logger.warn(
            {
              destinationChatId: this.destinationChatId,
              seconds: outcome.seconds,
              capped: cappedSeconds,
            },
            'flood_wait exceeds cap — clamping sleep',
          );
        }
        await this.deps.sleep(cappedSeconds * 1000, this.signal);
        if (this.signal.aborted) break;
        continue;
      }

      this.queue.shift();
      this.floodWaitCount = 0;
      this.lastSendAt = Date.now();
    }
    this.deps.logger.debug({ destinationChatId: this.destinationChatId }, 'worker stopped');
  }
}

export class ForwardingPipeline implements ForwardingHandle {
  private readonly workers = new Map<string, DestinationWorker>();
  private readonly abortController = new AbortController();
  private readonly workerDeps: WorkerDeps;
  private stopped = false;

  constructor(deps: PipelineDeps) {
    this.workerDeps = {
      forwarder: deps.forwarder,
      getDelayMs: deps.getDelayMs,
      logger: deps.logger,
      sleep: deps.sleep ?? cancellableSleep,
      ...(deps.onDeadLetter ? { onDeadLetter: deps.onDeadLetter } : {}),
    };
  }

  enqueue(job: ForwardJob): void {
    if (this.stopped) return;
    let worker = this.workers.get(job.destinationChatId);
    if (!worker) {
      worker = new DestinationWorker(
        job.destinationChatId,
        this.workerDeps,
        this.abortController.signal,
      );
      this.workers.set(job.destinationChatId, worker);
      worker.start();
    }
    worker.enqueue(job);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.abortController.abort();
    await Promise.all([...this.workers.values()].map((w) => w.stop()));
    this.workers.clear();
  }
}
