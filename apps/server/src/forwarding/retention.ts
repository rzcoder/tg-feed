// Keep the most recent maxRows rows by (createdAt DESC, id DESC), delete the rest.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

export const DEFAULT_FORWARD_LOG_MAX_ROWS = 10_000;

export interface PruneForwardLogDeps {
  db: Db;
  logger: Logger;
  // Retained-row cap; defaults to DEFAULT_FORWARD_LOG_MAX_ROWS. Test-only override (prod uses the default).
  maxRows?: number;
}

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
