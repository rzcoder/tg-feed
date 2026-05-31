/**
 * Per-destination FIFO queues with one worker each.
 *
 * Telegram throttles per receiving chat, so the throttling domain == the
 * destination chat. Workers are created lazily on first enqueue for a given
 * destination and run for the lifetime of the pipeline.
 *
 * Worker loop:
 *   1. Wait for a job (sleep on a wakeup promise).
 *   2. Sleep until at least `delayMs` has elapsed since the last successful
 *      attempt for this destination.
 *   3. Hand the job to the forwarder.
 *   4. On `flood_wait`: sleep `seconds * 1000` and retry the SAME job.
 *      On `sent`/`failed`: pop the job and move on.
 *
 * `stop()` aborts in-flight sleeps and waits for the current send to finish.
 */
import { setTimeout as nodeSleep } from 'node:timers/promises';
import type { Logger } from '../lib/logger.js';
import type { Forwarder } from './forwarder.js';
import type { ForwardJob, ForwardingHandle } from './types.js';

export const MAX_FLOOD_WAIT_SECONDS = 300;

export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

export const cancellableSleep: SleepFn = (ms, signal) =>
  nodeSleep(ms, undefined, { signal }).catch(() => undefined);

export interface PipelineDeps {
  forwarder: Forwarder;
  getDelayMs: () => number;
  logger: Logger;
  sleep?: SleepFn;
}

interface WorkerDeps {
  forwarder: Forwarder;
  getDelayMs: () => number;
  logger: Logger;
  sleep: SleepFn;
}

class DestinationWorker {
  private readonly queue: ForwardJob[] = [];
  private wakeup: () => void = () => {};
  private wakeupPromise: Promise<void>;
  private lastSendAt = 0;
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
