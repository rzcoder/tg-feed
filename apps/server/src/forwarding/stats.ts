/**
 * Aggregate counters over `forward_log`, used by the stats digest.
 *
 * The four buckets map 1:1 to the `status` enum: 'sent' = forwarded,
 * 'filtered' = dropped by a filter, 'failed' = permanent error,
 * 'flood_wait' = transient throttle (shown separately so it isn't
 * double-counted against the later 'sent' row a retry produces).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog } from '../db/schema.js';

export interface DigestStats {
  forwarded: number;
  filtered: number;
  failed: number;
  floodWait: number;
}

/**
 * Counts rows by status in the half-open window `[sinceMs, untilMs)`.
 * `created_at` is stored as integer epoch-ms, so we compare against raw
 * numbers rather than `Date` objects.
 */
export function getDigestStats(db: Db, sinceMs: number, untilMs: number): DigestStats {
  const rows = db
    .select({ status: forwardLog.status, n: sql<number>`count(*)` })
    .from(forwardLog)
    .where(sql`${forwardLog.createdAt} >= ${sinceMs} AND ${forwardLog.createdAt} < ${untilMs}`)
    .groupBy(forwardLog.status)
    .all();

  const stats: DigestStats = { forwarded: 0, filtered: 0, failed: 0, floodWait: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    if (row.status === 'sent') stats.forwarded = n;
    else if (row.status === 'filtered') stats.filtered = n;
    else if (row.status === 'failed') stats.failed = n;
    else if (row.status === 'flood_wait') stats.floodWait = n;
  }
  return stats;
}
