/**
 * Global app_settings readers.
 *
 * Both pipeline knobs (forward throttle delay + album debounce window) live
 * in the single `app_settings` row keyed `'global'` whose `value` JSON is a
 * `{ delayMs?, albumDebounceMs? }` shape. The Settings UI mutates the same
 * row and the pipeline reads it on every send / album flush, so changes
 * apply live without restart.
 *
 * Defensive defaults: a missing row, missing field, or non-positive number
 * all fall back to the documented defaults. We never want a malformed DB
 * row to disable throttling (would trip Telegram's anti-spam) or set a
 * negative debounce (would break the album setTimeout).
 */
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
