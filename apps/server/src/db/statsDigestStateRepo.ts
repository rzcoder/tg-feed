/**
 * Scheduler state for the stats digest, stored as JSON in the `app_settings`
 * row keyed `'stats_digest_state'`. Kept separate from the user-editable
 * `'global'` settings row so the scheduler's bookkeeping never collides with
 * the Settings PUT merge.
 *
 * Reads are defensive: a missing or malformed row reads as the empty baseline.
 */
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { appSettings } from './schema.js';

export const STATS_DIGEST_STATE_KEY = 'stats_digest_state';

export interface StatsDigestState {
  /** Epoch ms of the last send (or baseline). null before the first tick. */
  lastSentAt: number | null;
  /** Occurrence key of the last send/baseline. null before the first tick. */
  lastKey: string | null;
  /**
   * Fingerprint of the schedule config at the last tick. When it changes
   * (enable/disable, time, day, frequency, time zone), the scheduler
   * re-baselines instead of sending — so editing the schedule never fires an
   * immediate or backlog digest. null before the first tick.
   */
  configHash: string | null;
}

const EMPTY: StatsDigestState = { lastSentAt: null, lastKey: null, configHash: null };

export function readStatsDigestState(db: Db): StatsDigestState {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, STATS_DIGEST_STATE_KEY))
    .get();
  if (!row || typeof row.value !== 'object' || row.value === null) return { ...EMPTY };
  const v = row.value as Record<string, unknown>;
  return {
    lastSentAt:
      typeof v.lastSentAt === 'number' && Number.isFinite(v.lastSentAt) ? v.lastSentAt : null,
    lastKey: typeof v.lastKey === 'string' ? v.lastKey : null,
    configHash: typeof v.configHash === 'string' ? v.configHash : null,
  };
}

export function writeStatsDigestState(db: Db, state: StatsDigestState): void {
  db.insert(appSettings)
    .values({ key: STATS_DIGEST_STATE_KEY, value: state })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: state } })
    .run();
}
