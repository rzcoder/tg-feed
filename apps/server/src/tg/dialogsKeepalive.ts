// Secondary keepalive to the historyPoller: periodic getDialogs nudges gramjs to keep delivering NewMessage (gram-js/gramjs#280, #654). Unreliable alone, but cheap and narrows the miss window.
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';
import { createPoller, type Poller } from '../lib/poller.js';

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

export type DialogsKeepalive = Poller;

export function createDialogsKeepalive(deps: DialogsKeepaliveDeps): DialogsKeepalive {
  const { client, logger } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  let inFlight = false;

  async function ping(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await client.getDialogs({ limit: KEEPALIVE_LIMIT });
    } catch (err) {
      // Debug-level: transient failures are expected and the poller/access monitor surface persistent issues.
      logger.debug({ err }, 'dialogs keepalive ping failed');
    } finally {
      inFlight = false;
    }
  }

  return createPoller({
    intervalMs,
    run: ping,
    logger,
    errorLogMessage: 'dialogs keepalive: tick rejected',
    runOnStart: false,
  });
}
