/**
 * Periodic Telegram connection health probe.
 *
 * gramjs's `autoReconnect` papers over short transport hiccups but doesn't
 * detect every failure mode that breaks NewMessage delivery — for example,
 * `AUTH_KEY_UNREGISTERED` (logout from another device) or a sender stuck in
 * a half-open state. Without an active probe `TelegramStatus` would stay
 * `connected: true` forever, even when no events are flowing.
 *
 * The monitor calls `updates.getState` on a fixed interval. It's the lightest
 * authenticated request that touches the same update sub-system the listener
 * depends on, so a successful response is reasonable evidence that updates
 * would also flow. On error we publish `connected: false` with the upstream
 * reason; on recovery we publish `connected: true` again.
 *
 * The monitor never throws — caller errors propagate via `onStatusChange`.
 */
import { Api } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';

export const HEALTH_CHECK_INTERVAL_MS = 60_000;

/**
 * Minimal slice of TelegramClient used here so tests can pass a stub.
 */
export interface HealthProbeClient {
  invoke(request: unknown): Promise<unknown>;
}

export interface HealthMonitorDeps {
  client: HealthProbeClient;
  logger: Logger;
  onStatusChange: (status: TelegramStatus) => void;
  intervalMs?: number;
}

export interface HealthMonitor {
  start(): void;
  stop(): void;
  /** Run one probe immediately. Exposed for tests. */
  probe(): Promise<void>;
}

export function createHealthMonitor(deps: HealthMonitorDeps): HealthMonitor {
  const { client, logger, onStatusChange } = deps;
  const intervalMs = deps.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let lastConnected: boolean | undefined;

  async function probe(): Promise<void> {
    if (stopped) return;
    try {
      await client.invoke(new Api.updates.GetState());
      if (lastConnected !== true) {
        logger.info('Telegram health check: connected');
      }
      lastConnected = true;
      onStatusChange({ state: 'connected', connected: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      if (lastConnected !== false) {
        logger.warn({ err }, 'Telegram health check failed');
      }
      lastConnected = false;
      onStatusChange({ state: 'disconnected', connected: false, reason });
    }
  }

  return {
    start(): void {
      if (timer || stopped) return;
      void probe();
      timer = setInterval(() => void probe(), intervalMs);
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    probe,
  };
}
