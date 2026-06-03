// Pipeline knobs in the single 'global' app_settings row; read on every send/flush so changes apply live.
// Missing/non-positive values fall back to defaults so a bad row can't disable throttling (Telegram anti-spam) or break the album setTimeout.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

export const GLOBAL_SETTINGS_KEY = 'global';
export const DEFAULT_DELAY_MS = 8000;
export const DEFAULT_ALBUM_DEBOUNCE_MS = 2000;

export function readGlobalValue(db: Db): Record<string, unknown> | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, GLOBAL_SETTINGS_KEY)).get();
  if (!row) return null;
  const value = row.value;
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function readPositiveInt(value: Record<string, unknown> | null, key: string): number | null {
  if (!value) return null;
  const candidate = value[key];
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    return null;
  }
  return candidate;
}

export function getGlobalDelayMs(db: Db): number {
  return readPositiveInt(readGlobalValue(db), 'delayMs') ?? DEFAULT_DELAY_MS;
}

export function getAlbumDebounceMs(db: Db): number {
  return readPositiveInt(readGlobalValue(db), 'albumDebounceMs') ?? DEFAULT_ALBUM_DEBOUNCE_MS;
}
