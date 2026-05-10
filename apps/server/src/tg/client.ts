import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import type { Config } from '../config.js';

export interface TelegramEnv {
  apiId: number;
  apiHash: string;
  sessionString: string;
}

export interface TelegramEnvResult {
  ok: boolean;
  env?: TelegramEnv;
  /** Human-readable reason when `ok === false`; safe to surface in API. */
  reason?: string;
}

// Non-throwing variant — used by the server entrypoint to support degraded
// boot (no Telegram client; API + DB still come up). Callers that genuinely
// require credentials use `requireTelegramEnv` below.
export function readTelegramEnv(cfg: Config): TelegramEnvResult {
  const missing: string[] = [];
  if (cfg.TG_API_ID === undefined) missing.push('TG_API_ID');
  if (!cfg.TG_API_HASH) missing.push('TG_API_HASH');
  if (!cfg.TG_SESSION_STRING) missing.push('TG_SESSION_STRING');
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Missing required Telegram env vars: ${missing.join(', ')}. ` +
        `Set them in .env (run \`pnpm tg:login\` to mint a session string).`,
    };
  }
  return {
    ok: true,
    env: {
      apiId: cfg.TG_API_ID as number,
      apiHash: cfg.TG_API_HASH as string,
      sessionString: cfg.TG_SESSION_STRING as string,
    },
  };
}

export function requireTelegramEnv(cfg: Config): TelegramEnv {
  const result = readTelegramEnv(cfg);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.env as TelegramEnv;
}

export interface CreateTelegramClientOptions {
  apiId: number;
  apiHash: string;
  sessionString: string;
  gramjsLogLevel?: LogLevel;
}

// gramjs retries connect this many times with exponential backoff before
// giving up and throwing — the listener's safe-handler catches downstream
// failures, but `connect()` itself bubbles to the boot path's degraded mode.
const CONNECTION_RETRIES = 5;

export function createTelegramClient(opts: CreateTelegramClientOptions): TelegramClient {
  const session = new StringSession(opts.sessionString);
  const client = new TelegramClient(session, opts.apiId, opts.apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
  // gramjs's own logger is loud by default; pin it to warn unless overridden.
  client.setLogLevel(opts.gramjsLogLevel ?? LogLevel.WARN);
  return client;
}

// `destroy` alone leaves the auto-reconnect loop running and the process
// won't exit cleanly on SIGINT. Order matters: disconnect first, then destroy.
export async function disconnectClient(client: TelegramClient): Promise<void> {
  await client.disconnect();
  await client.destroy();
}
