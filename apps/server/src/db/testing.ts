/**
 * Test fixture: an in-memory SQLite DB with all migrations applied.
 *
 * Use per-test via beforeEach/afterEach for clean isolation. Setup is
 * sub-millisecond after the first call (better-sqlite3 keeps native code
 * loaded; migrations are tiny CREATE TABLE statements).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db, type DbHandle } from './client.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, '../../drizzle');

export interface TestDbHandle {
  db: Db;
  close: () => void;
}

export function createTestDb(): TestDbHandle {
  const handle: DbHandle = createDb(':memory:');
  migrate(handle.db, { migrationsFolder });
  return {
    db: handle.db,
    close: () => handle.sqlite.close(),
  };
}
