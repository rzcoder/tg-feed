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
  // FKs off around migrate() so table-recreation migrations don't trigger CASCADE/SET NULL on rename.
  handle.sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(handle.db, { migrationsFolder });
  } finally {
    handle.sqlite.pragma('foreign_keys = ON');
  }
  return {
    db: handle.db,
    close: () => handle.sqlite.close(),
  };
}
