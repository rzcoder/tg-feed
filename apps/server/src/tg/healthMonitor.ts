// Active probe because gramjs's autoReconnect can sit in a stuck state (e.g. AUTH_KEY_UNREGISTERED,
// isReconnecting stuck true) that breaks NewMessage delivery while TelegramStatus stays connected:true.
// updates.getState hits the same update sub-system the listener needs; N failures trigger requestReload().
import { Api } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';
import { createPoller } from '../lib/poller.js';

export const HEALTH_CHECK_INTERVAL_MS = 20_000;
export const HEALTH_CHECK_PROBE_TIMEOUT_MS = 10_000;
export const HEALTH_CHECK_RELOAD_THRESHOLD = 3;

export interface HealthProbeClient {
  invoke(request: unknown): Promise<unknown>;
}

export interface HealthMonitorDeps {
  client: HealthProbeClient;
  logger: Logger;
  onStatusChange: (status: TelegramStatus) => void;
  // Called after reloadThreshold consecutive failures; coalesces concurrent reloads via its own mutex.
  requestReload?: () => Promise<void>;
  intervalMs?: number;
  probeTimeoutMs?: number;
  reloadThreshold?: number;
}

export interface HealthMonitor {
  start(): void;
  stop(): void;
  // Run one probe immediately; exposed for tests.
  probe(): Promise<void>;
}

export function createHealthMonitor(deps: HealthMonitorDeps): HealthMonitor {
  const { client, logger, onStatusChange, requestReload } = deps;
  const intervalMs = deps.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  const probeTimeoutMs = deps.probeTimeoutMs ?? HEALTH_CHECK_PROBE_TIMEOUT_MS;
  const reloadThreshold = deps.reloadThreshold ?? HEALTH_CHECK_RELOAD_THRESHOLD;
  let stopped = false;
  let lastConnected: boolean | undefined;
  let consecutiveFailures = 0;
  let reloadInFlight = false;

  async function invokeWithTimeout(): Promise<void> {
    await Promise.race([
      client.invoke(new Api.updates.GetState()),
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(probeTimeoutMs).addEventListener(
          'abort',
          () => reject(new Error(`probe timed out after ${probeTimeoutMs}ms`)),
          { once: true },
        );
      }),
    ]);
  }

  async function probe(): Promise<void> {
    // Skip while a reload is mid-flight: a probe on the about-to-be-torn-down client would race the swap.
    if (stopped || reloadInFlight) return;
    try {
      await invokeWithTimeout();
      if (lastConnected !== true) {
        logger.info({ recovered: lastConnected === false }, 'Telegram health check: connected');
      }
      lastConnected = true;
      consecutiveFailures = 0;
      onStatusChange({ state: 'connected', connected: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      consecutiveFailures += 1;
      // First failure after a healthy streak logs ERROR; continued failures drop to WARN to avoid spam.
      if (lastConnected !== false) {
        logger.error({ err, consecutiveFailures }, 'Telegram health check failed');
      } else {
        logger.warn({ err, consecutiveFailures }, 'Telegram health check still failing');
      }
      lastConnected = false;
      onStatusChange({ state: 'disconnected', connected: false, reason });

      if (requestReload && consecutiveFailures >= reloadThreshold) {
        // Reset before firing so a post-reload failure doesn't immediately re-trigger; reloadInFlight gates the window.
        consecutiveFailures = 0;
        reloadInFlight = true;
        logger.error(
          { threshold: reloadThreshold },
          'Telegram health check exceeded failure threshold — triggering session reload',
        );
        // Fire-and-forget; requestReload coalesces so reloads can't stack.
        void requestReload()
          .catch((reloadErr) => {
            logger.error({ err: reloadErr }, 'health-triggered Telegram reload failed');
          })
          .finally(() => {
            reloadInFlight = false;
          });
      }
    }
  }

  const poller = createPoller({
    intervalMs,
    run: probe,
    logger,
    errorLogMessage: 'Telegram health check: probe rejected',
  });

  return {
    start: poller.start,
    stop(): void {
      stopped = true;
      poller.stop();
    },
    probe,
  };
}
