/**
 * Forward-log retention.
 *
 * Without periodic pruning, every forwarded message accumulates a row plus a
 * (potentially large) `raw_message` JSON blob in `forward_log`. A subscribed
 * channel can pump thousands of messages a day; over months the file balloons
 * to GBs and read latency degrades.
 *
 * Policy: keep the most recent `maxRows` rows by `(createdAt DESC, id DESC)`,
 * delete everything else. SQLite handles the DELETE…WHERE id NOT IN (SELECT…)
 * pattern fine at this scale; we also add a hard cap on `raw_message` byte
 * length at insert time so a single pathological payload can't dwarf the rest
 * of the column.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

export const DEFAULT_FORWARD_LOG_MAX_ROWS = 10_000;

export interface PruneForwardLogDeps {
  db: Db;
  logger: Logger;
  /** Hard cap on retained rows. Override via env on the boot path. */
  maxRows?: number;
}

/**
 * Returns the number of rows deleted. Idempotent — a fresh DB with fewer
 * than `maxRows` rows is a no-op.
 */
export function pruneForwardLog(deps: PruneForwardLogDeps): number {
  const { db, logger } = deps;
  const maxRows = deps.maxRows ?? DEFAULT_FORWARD_LOG_MAX_ROWS;
  if (maxRows <= 0) return 0;
  const result = db
    .delete(forwardLog)
    .where(
      sql`${forwardLog.id} NOT IN (
        SELECT ${forwardLog.id} FROM ${forwardLog}
        ORDER BY ${forwardLog.createdAt} DESC, ${forwardLog.id} DESC
        LIMIT ${maxRows}
      )`,
    )
    .run();
  if (result.changes > 0) {
    logger.info({ deleted: result.changes, kept: maxRows }, 'forward-log retention: pruned rows');
  }
  return result.changes;
}
