import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { getActiveAccount } from '../db/telegramAccountRepo.js';
import {
  decryptSessionString,
  getKeyFingerprint,
  loadEncryptionKey,
} from '../lib/sessionCrypto.js';
import type { Logger } from '../lib/logger.js';

export interface TelegramEnv {
  apiId: number;
  apiHash: string;
  sessionString: string;
}

export interface TelegramEnvResult {
  ok: boolean;
  env?: TelegramEnv;
  source?: 'db' | 'env';
  // Safe to surface in the API when ok === false.
  reason?: string;
}

// Non-throwing variant supporting degraded boot (no client; API + DB still come up).
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
    source: 'env',
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

// DB account (when key fingerprint matches) → env TG_SESSION_STRING → degraded reason.
// A fingerprint mismatch is skipped, never auto-deleted; /api/tg/account surfaces the mismatch.
export function resolveTelegramEnv(deps: {
  cfg: Config;
  db: Db;
  logger: Logger;
}): TelegramEnvResult {
  const { cfg, db, logger } = deps;
  if (cfg.TG_API_ID === undefined || !cfg.TG_API_HASH) {
    const missing: string[] = [];
    if (cfg.TG_API_ID === undefined) missing.push('TG_API_ID');
    if (!cfg.TG_API_HASH) missing.push('TG_API_HASH');
    return {
      ok: false,
      reason: `Missing required Telegram env vars: ${missing.join(', ')}. Get them at https://my.telegram.org.`,
    };
  }

  const row = getActiveAccount(db);
  if (row) {
    const key = loadEncryptionKey(cfg);
    if (!key) {
      logger.warn(
        { rowId: row.id, fingerprint: row.keyFingerprint },
        'telegram_account row exists but TG_SESSION_ENCRYPTION_KEY is unset; falling through to env',
      );
    } else if (getKeyFingerprint(key) !== row.keyFingerprint) {
      logger.warn(
        {
          rowId: row.id,
          rowFingerprint: row.keyFingerprint,
          currentFingerprint: getKeyFingerprint(key),
        },
        'telegram_account row encrypted with a different key; falling through to env',
      );
    } else {
      try {
        const sessionString = decryptSessionString(
          { ciphertext: row.encryptedSessionString, keyFingerprint: row.keyFingerprint },
          key,
        );
        return {
          ok: true,
          source: 'db',
          env: {
            apiId: cfg.TG_API_ID,
            apiHash: cfg.TG_API_HASH,
            sessionString,
          },
        };
      } catch (err) {
        logger.error(
          { rowId: row.id, err: err instanceof Error ? err.message : String(err) },
          'failed to decrypt telegram_account row; falling through to env',
        );
      }
    }
  }

  if (cfg.TG_SESSION_STRING) {
    return {
      ok: true,
      source: 'env',
      env: {
        apiId: cfg.TG_API_ID,
        apiHash: cfg.TG_API_HASH,
        sessionString: cfg.TG_SESSION_STRING,
      },
    };
  }

  return {
    ok: false,
    reason:
      'No Telegram session available. Sign in via Settings → Connection, or set TG_SESSION_STRING in .env.',
  };
}

export interface CreateTelegramClientOptions {
  apiId: number;
  apiHash: string;
  sessionString: string;
  gramjsLogLevel?: LogLevel;
}

// connect() bubbles to the boot path's degraded mode after this many retries.
const CONNECTION_RETRIES = 5;

export function createTelegramClient(opts: CreateTelegramClientOptions): TelegramClient {
  const session = new StringSession(opts.sessionString);
  const client = new TelegramClient(session, opts.apiId, opts.apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
  // gramjs's logger is loud by default; pin to warn unless overridden.
  client.setLogLevel(opts.gramjsLogLevel ?? LogLevel.WARN);
  return client;
}

// Order matters: disconnect before destroy, else the reconnect loop keeps the process alive on SIGINT.
export async function disconnectClient(client: TelegramClient): Promise<void> {
  await client.disconnect();
  await client.destroy();
}
