/**
 * Periodic `client.getDialogs` ping that keeps gramjs's update stream alive.
 *
 * The primary fix for "channel updates silently stop" is the `historyPoller`
 * — it actually fetches missed messages. This keepalive is the secondary,
 * cheap signal: gramjs maintainer painor documented in
 * https://github.com/gram-js/gramjs/issues/280 that calling `getEntity` /
 * `getMessages` / `getDialogs` periodically nudges Telegram to keep
 * delivering NewMessage events. Issue
 * https://github.com/gram-js/gramjs/issues/654 reports a 30s-interval
 * `getDialogs` call stabilising the update stream for 24h+.
 *
 * On its own this is unreliable for high-volume channels — that's what the
 * poller is for — but pairing the two narrows the window between a missed
 * post and a poller sweep, and is essentially free (one cheap RPC every
 * 30s).
 */
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';

export const DEFAULT_KEEPALIVE_INTERVAL_MS = 30 * 1000;
const KEEPALIVE_LIMIT = 10;

export interface DialogsKeepaliveClient {
  getDialogs: TelegramClient['getDialogs'];
}

export interface DialogsKeepaliveDeps {
  client: DialogsKeepaliveClient;
  logger: Logger;
  intervalMs?: number;
}

export interface DialogsKeepalive {
  start(): void;
  stop(): void;
}

export function createDialogsKeepalive(deps: DialogsKeepaliveDeps): DialogsKeepalive {
  const { client, logger } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let inFlight = false;

  async function ping(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await client.getDialogs({ limit: KEEPALIVE_LIMIT });
    } catch (err) {
      // Single bad call must not stop the timer — we want to keep retrying
      // on the next tick. Log at debug to avoid noise on transient errors;
      // the historyPoller and access monitor will surface persistent issues.
      logger.debug({ err }, 'dialogs keepalive ping failed');
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      if (timer || stopped) return;
      timer = setInterval(() => {
        void ping();
      }, intervalMs);
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
