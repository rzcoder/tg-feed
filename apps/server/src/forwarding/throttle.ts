/**
 * Global throttle delay between forwarded sends.
 *
 * Sourced from `app_settings` row keyed `'global'` so the (future) Settings
 * UI can change it live without restart. Defaults to 8 s — middle of the
 * 5–15 s band the PLAN recommends. A missing row, missing field, or
 * non-positive number all fall back to the default; we never want a bad DB
 * row to disable throttling and trip Telegram's anti-spam.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

export const GLOBAL_SETTINGS_KEY = 'global';
export const DEFAULT_DELAY_MS = 8000;

export function getGlobalDelayMs(db: Db): number {
  const row = db.select().from(appSettings).where(eq(appSettings.key, GLOBAL_SETTINGS_KEY)).get();
  if (!row) return DEFAULT_DELAY_MS;

  const value = row.value;
  if (typeof value !== 'object' || value === null) return DEFAULT_DELAY_MS;
  const candidate = (value as Record<string, unknown>).delayMs;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_DELAY_MS;
  }
  return candidate;
}
