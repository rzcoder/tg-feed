// Stats-digest scheduler state, kept in its own app_settings row so it never collides with the user-editable 'global' Settings merge; missing/malformed reads as the empty baseline.
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { appSettings } from './schema.js';

export const STATS_DIGEST_STATE_KEY = 'stats_digest_state';

export interface StatsDigestState {
  // Epoch ms of the last send/baseline.
  lastSentAt: number | null;
  lastKey: string | null;
  // Schedule-config fingerprint; on change the scheduler re-baselines instead of firing a backlog digest.
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
