/**
 * DB-over-env resolver for the Telegram bot configuration.
 */
import type { BotAdmin, BotConfigInfo, BotConfigSource } from '@tg-feed/shared';
import type { TelegramAuth } from '../api/auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { readBotConfigRaw } from '../db/botConfigRepo.js';
import type { Logger } from '../lib/logger.js';
import {
  BOT_TOKEN_AAD,
  decryptSecret,
  getKeyFingerprint,
  loadEncryptionKey,
} from '../lib/sessionCrypto.js';

export interface ResolveBotDeps {
  cfg: Config;
  db: Db;
  logger: Logger;
}

type ReadDeps = Pick<ResolveBotDeps, 'cfg' | 'db'>;

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids.map((s) => s.trim()).filter((s) => s.length > 0)));
}

/** Resolve the bot token DB→env. Logs (once per call) when it skips a stored row. */
function resolveBotToken(deps: ResolveBotDeps): {
  token: string | null;
  source: BotConfigSource | null;
} {
  const { cfg, db, logger } = deps;
  const stored = readBotConfigRaw(db);
  if (stored.token) {
    const key = loadEncryptionKey(cfg);
    if (!key) {
      logger.warn(
        { fingerprint: stored.token.keyFingerprint },
        'bot token stored in DB but TG_SESSION_ENCRYPTION_KEY is unset; falling through to env',
      );
    } else if (getKeyFingerprint(key) !== stored.token.keyFingerprint) {
      logger.warn(
        { rowFingerprint: stored.token.keyFingerprint, currentFingerprint: getKeyFingerprint(key) },
        'bot token encrypted with a different key; falling through to env',
      );
    } else {
      try {
        return { token: decryptSecret(stored.token, key, BOT_TOKEN_AAD), source: 'db' };
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to decrypt stored bot token; falling through to env',
        );
      }
    }
  }
  if (cfg.TG_BOT_TOKEN) return { token: cfg.TG_BOT_TOKEN, source: 'env' };
  return { token: null, source: null };
}

/**
 * Resolve the admin allowlist DB→env. DB entries carry display names (from
 * the `@username` lookup); env entries are raw ids with null names.
 */
function resolveAdmins(deps: ReadDeps): { admins: BotAdmin[]; source: BotConfigSource | null } {
  const { cfg, db } = deps;
  const stored = readBotConfigRaw(db);
  if (stored.admins && stored.admins.length > 0) {
    return { admins: dedupeAdmins(stored.admins), source: 'db' };
  }
  if (cfg.TG_BOT_ADMIN_IDS.length > 0) {
    return {
      admins: cfg.TG_BOT_ADMIN_IDS.map((id) => ({ id, displayName: null, username: null })),
      source: 'env',
    };
  }
  return { admins: [], source: null };
}

function resolveAdminIds(deps: ReadDeps): { adminIds: string[]; source: BotConfigSource | null } {
  const { admins, source } = resolveAdmins(deps);
  return { adminIds: dedupe(admins.map((a) => a.id)), source };
}

function dedupeAdmins(admins: BotAdmin[]): BotAdmin[] {
  const seen = new Set<string>();
  const out: BotAdmin[] = [];
  for (const a of admins) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

function resolvePublicUrlWithSource(deps: ReadDeps): {
  publicUrl: string | undefined;
  source: BotConfigSource | null;
} {
  const { cfg, db } = deps;
  const stored = readBotConfigRaw(db);
  if (stored.publicUrl) return { publicUrl: stored.publicUrl, source: 'db' };
  if (cfg.PUBLIC_URL) return { publicUrl: cfg.PUBLIC_URL, source: 'env' };
  return { publicUrl: undefined, source: null };
}

/**
 * Resolved bot auth (token + admin allowlist), or null when the bot is not
 * configured. Enabled only when a token resolves AND at least one admin id
 * resolves.
 */
export function resolveTelegramAuth(deps: ResolveBotDeps): TelegramAuth | null {
  const { token } = resolveBotToken(deps);
  if (!token) return null;
  const { adminIds } = resolveAdminIds(deps);
  if (adminIds.length === 0) return null;
  return { botToken: token, adminIds };
}

/** Resolved public URL DB→env (used for the bot's Mini App button). */
export function resolvePublicUrl(deps: ReadDeps): string | undefined {
  return resolvePublicUrlWithSource(deps).publicUrl;
}

/**
 * Masked, read-only view for `GET /api/config/bot`. Never logs and never
 * returns the token. `keyFingerprintMismatch` is true when a token is stored
 * but unusable with the current key (key unset or fingerprint differs).
 */
export function buildBotConfigInfo(deps: {
  cfg: Config;
  db: Db;
  getEncryptionKey?: () => Buffer | null;
  getBotRunning: () => boolean;
}): BotConfigInfo {
  const { cfg, db } = deps;
  const stored = readBotConfigRaw(db);
  const key = deps.getEncryptionKey ? deps.getEncryptionKey() : loadEncryptionKey(cfg);

  const tokenUsable =
    !!stored.token && key !== null && getKeyFingerprint(key) === stored.token.keyFingerprint;
  let tokenSource: BotConfigSource | null = null;
  if (tokenUsable) tokenSource = 'db';
  else if (cfg.TG_BOT_TOKEN) tokenSource = 'env';

  const admins = resolveAdmins({ cfg, db });
  const pub = resolvePublicUrlWithSource({ cfg, db });

  return {
    tokenConfigured: tokenSource !== null,
    tokenSource,
    encryptionKeyConfigured: key !== null,
    keyFingerprintMismatch: !!stored.token && !tokenUsable,
    admins: admins.admins,
    adminsSource: admins.source,
    publicUrl: pub.publicUrl ?? null,
    publicUrlSource: pub.source,
    botRunning: deps.getBotRunning(),
  };
}
