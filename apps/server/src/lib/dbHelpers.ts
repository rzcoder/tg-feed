import { count, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';

export function countWhere(db: Db, table: SQLiteTable, where: SQL): number {
  const row = db.select({ c: count() }).from(table).where(where).get();
  return Number(row?.c ?? 0);
}
