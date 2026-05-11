/**
 * Periodic Telegram connection health probe + auto-recovery.
 *
 * gramjs's `autoReconnect` papers over short transport hiccups but doesn't
 * detect every failure mode that breaks NewMessage delivery — for example,
 * `AUTH_KEY_UNREGISTERED` (logout from another device), a sender stuck in a
 * half-open state, or a reconnect loop where `_sender.isReconnecting`
 * stays `true` forever and the update loop silently skips every ping
 * (see [updates.js:209]). Without an active probe `TelegramStatus` would
 * stay `connected: true` forever, even when no events are flowing.
 *
 * The monitor calls `updates.getState` on a fixed interval. It's the lightest
 * authenticated request that touches the same update sub-system the listener
 * depends on, so a successful response is reasonable evidence that updates
 * would also flow. On error we publish `connected: false` with the upstream
 * reason; on recovery we publish `connected: true` again.
 *
 * After `RELOAD_THRESHOLD` consecutive failures we additionally invoke the
 * caller-supplied `requestReload()` to force a full client teardown +
 * recreate via the same path the Settings UI uses for re-login. This catches
 * the "process alive, gramjs stuck" failure mode that no amount of internal
 * retry will recover from.
 *
 * The monitor never throws — caller errors propagate via `onStatusChange`.
 */
import { Api } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';

export const HEALTH_CHECK_INTERVAL_MS = 20_000;
export const HEALTH_CHECK_PROBE_TIMEOUT_MS = 10_000;
export const HEALTH_CHECK_RELOAD_THRESHOLD = 3;

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
  /**
   * Called after `reloadThreshold` consecutive probe failures. Optional —
   * tests that only assert status emission can omit it. In production this
   * is wired to `reloadTelegramSession()` from the entrypoint, which
   * coalesces concurrent reload requests via its own mutex.
   */
  requestReload?: () => Promise<void>;
  intervalMs?: number;
  probeTimeoutMs?: number;
  reloadThreshold?: number;
}

export interface HealthMonitor {
  start(): void;
  stop(): void;
  /** Run one probe immediately. Exposed for tests. */
  probe(): Promise<void>;
}

export function createHealthMonitor(deps: HealthMonitorDeps): HealthMonitor {
  const { client, logger, onStatusChange, requestReload } = deps;
  const intervalMs = deps.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  const probeTimeoutMs = deps.probeTimeoutMs ?? HEALTH_CHECK_PROBE_TIMEOUT_MS;
  const reloadThreshold = deps.reloadThreshold ?? HEALTH_CHECK_RELOAD_THRESHOLD;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let lastConnected: boolean | undefined;
  let consecutiveFailures = 0;
  let reloadInFlight = false;

  async function invokeWithTimeout(): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.invoke(new Api.updates.GetState()),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`probe timed out after ${probeTimeoutMs}ms`)),
            probeTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async function probe(): Promise<void> {
    // Skip probes while a reload is mid-flight: the old client is about to
    // be torn down, and a successful probe on it would just race with the
    // swap. The new monitor (created post-reload) will resume probing.
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
      // First failure after a healthy streak is the most diagnostic signal —
      // surface as ERROR. Continued failures drop to WARN to avoid log spam,
      // since the auto-reload below already escalates if it stays broken.
      if (lastConnected !== false) {
        logger.error({ err, consecutiveFailures }, 'Telegram health check failed');
      } else {
        logger.warn({ err, consecutiveFailures }, 'Telegram health check still failing');
      }
      lastConnected = false;
      onStatusChange({ state: 'disconnected', connected: false, reason });

      if (requestReload && consecutiveFailures >= reloadThreshold) {
        // Reset before firing so that if reload completes and the new client
        // also fails, we don't immediately re-trigger on the very next probe
        // (the new monitor will start its own counter from 0 anyway). The
        // `reloadInFlight` gate covers the in-flight window.
        consecutiveFailures = 0;
        reloadInFlight = true;
        logger.error(
          { threshold: reloadThreshold },
          'Telegram health check exceeded failure threshold — triggering session reload',
        );
        // Fire-and-forget. `requestReload` has its own coalescing mutex in
        // the entrypoint, so we can't accidentally stack reloads. The
        // `.finally` clears `reloadInFlight` even if the swap throws — but
        // by then `stop()` will have already been called on this monitor as
        // part of the old runtime teardown, so the flag is moot.
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
