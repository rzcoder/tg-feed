import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import type { Config } from '../config.js';

export interface TelegramEnv {
  apiId: number;
  apiHash: string;
  sessionString: string;
}

export function requireTelegramEnv(cfg: Config): TelegramEnv {
  const missing: string[] = [];
  if (cfg.TG_API_ID === undefined) missing.push('TG_API_ID');
  if (!cfg.TG_API_HASH) missing.push('TG_API_HASH');
  if (!cfg.TG_SESSION_STRING) missing.push('TG_SESSION_STRING');
  if (missing.length > 0) {
    throw new Error(
      `Missing required Telegram env vars: ${missing.join(', ')}. ` +
        `Run \`pnpm tg:login\` to mint a session string.`,
    );
  }
  return {
    apiId: cfg.TG_API_ID as number,
    apiHash: cfg.TG_API_HASH as string,
    sessionString: cfg.TG_SESSION_STRING as string,
  };
}

export interface CreateTelegramClientOptions {
  apiId: number;
  apiHash: string;
  sessionString: string;
  gramjsLogLevel?: LogLevel;
}

export function createTelegramClient(opts: CreateTelegramClientOptions): TelegramClient {
  const session = new StringSession(opts.sessionString);
  const client = new TelegramClient(session, opts.apiId, opts.apiHash, {
    connectionRetries: 5,
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
