// Periodic `run` invoker with idempotent start/stop; rejections are caught and logged so one bad tick never breaks the loop. In-flight/dedup deliberately stays in `run` — call sites differ.
import type { Logger } from './logger.js';

export interface PollerOptions {
  intervalMs: number;
  run: () => Promise<void>;
  logger: Logger;
  errorLogMessage: string;
  /** Invoke `run` immediately on `start()`. Default `true`. */
  runOnStart?: boolean;
}

export interface Poller {
  start(): void;
  stop(): void;
}

export function createPoller(opts: PollerOptions): Poller {
  const { intervalMs, run, logger, errorLogMessage } = opts;
  const runOnStart = opts.runOnStart ?? true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function tick(): void {
    if (stopped) return;
    void run().catch((err) => {
      logger.error({ err }, errorLogMessage);
    });
  }

  return {
    start(): void {
      if (timer || stopped) return;
      if (runOnStart) tick();
      timer = setInterval(tick, intervalMs);
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
