/**
 * Repository for the DB-backed bot configuration, stored as JSON in the
 * `app_settings` row keyed `'bot'`. Shape:
 *
 *   { token?: EncryptedEnvelope; admins?: BotAdmin[]; publicUrl?: string }
 *
 * (A legacy `adminIds: string[]` shape from before display-name support is
 * still read and upgraded on the fly.)
 *
 * The token arrives already encrypted; this repo only stores and merges the
 * envelope. Reads are defensive: a missing row or any malformed field yields
 * an absent value, so a hand-edited or partially-written row can't crash the
 * resolver — it just falls back to env.
 */
import { eq } from 'drizzle-orm';
import type { BotAdmin } from '@tg-feed/shared';
import type { Db } from './client.js';
import { appSettings } from './schema.js';
import type { EncryptedEnvelope } from '../lib/sessionCrypto.js';

export const BOT_SETTINGS_KEY = 'bot';

export interface StoredBotConfig {
  token?: EncryptedEnvelope;
  admins?: BotAdmin[];
  publicUrl?: string;
}

/**
 * Partial update. Per field: `undefined` = leave unchanged, `null` = clear
 * (the resolver then falls back to env), a value = set it.
 */
export interface BotConfigPatch {
  token?: EncryptedEnvelope | null;
  admins?: BotAdmin[] | null;
  publicUrl?: string | null;
}

function asEnvelope(value: unknown): EncryptedEnvelope | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.ciphertext === 'string' && typeof o.keyFingerprint === 'string') {
    return { ciphertext: o.ciphertext, keyFingerprint: o.keyFingerprint };
  }
  return undefined;
}

function asAdmins(value: Record<string, unknown>): BotAdmin[] | undefined {
  if (Array.isArray(value.admins)) {
    const out: BotAdmin[] = [];
    for (const item of value.admins) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        if (typeof o.id === 'string' && /^\d+$/.test(o.id)) {
          out.push({
            id: o.id,
            displayName: typeof o.displayName === 'string' ? o.displayName : null,
            username: typeof o.username === 'string' ? o.username : null,
          });
        }
      }
    }
    return out;
  }
  // Legacy: an older `adminIds: string[]` shape (pre display-name support).
  if (Array.isArray(value.adminIds)) {
    return value.adminIds
      .filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x))
      .map((id) => ({ id, displayName: null, username: null }));
  }
  return undefined;
}

export function readBotConfigRaw(db: Db): StoredBotConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, BOT_SETTINGS_KEY)).get();
  if (!row || typeof row.value !== 'object' || row.value === null) return {};
  const value = row.value as Record<string, unknown>;
  const out: StoredBotConfig = {};
  const token = asEnvelope(value.token);
  if (token) out.token = token;
  const admins = asAdmins(value);
  if (admins) out.admins = admins;
  if (typeof value.publicUrl === 'string') out.publicUrl = value.publicUrl;
  return out;
}

export function writeBotConfig(db: Db, patch: BotConfigPatch): StoredBotConfig {
  const next: StoredBotConfig = { ...readBotConfigRaw(db) };
  if (patch.token !== undefined) {
    if (patch.token === null) delete next.token;
    else next.token = patch.token;
  }
  if (patch.admins !== undefined) {
    if (patch.admins === null) delete next.admins;
    else next.admins = patch.admins;
  }
  if (patch.publicUrl !== undefined) {
    if (patch.publicUrl === null) delete next.publicUrl;
    else next.publicUrl = patch.publicUrl;
  }
  db.insert(appSettings)
    .values({ key: BOT_SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next } })
    .run();
  return next;
}

export function clearBotConfig(db: Db): void {
  db.delete(appSettings).where(eq(appSettings.key, BOT_SETTINGS_KEY)).run();
}
