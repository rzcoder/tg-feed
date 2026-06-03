// Bot config as JSON in app_settings['bot']. Reads are defensive: a malformed field falls back to env, never throws.
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

// Per field: undefined = unchanged, null = clear (resolver falls back to env), value = set.
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
  // Legacy adminIds: string[] (pre display-name).
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
