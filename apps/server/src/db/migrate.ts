import '../lib/loadEnv.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, resolveDatabasePath } from './client.js';
import { config } from '../config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, '../../drizzle');

const handle = createDb(config.DATABASE_PATH);
try {
  // FKs off around table-recreation migrations, else CASCADE/SET NULL fire on the old-table drop and wipe referencing rows; migrate()'s transaction makes the PRAGMA a no-op so set it here. foreign_key_check verifies no orphans before re-enabling.
  handle.sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(handle.db, { migrationsFolder });
    const violations = handle.sqlite.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(`Migration left FK violations:\n${JSON.stringify(violations, null, 2)}`);
    }
  } finally {
    handle.sqlite.pragma('foreign_keys = ON');
  }
  console.log(`migrations applied → ${resolveDatabasePath(config.DATABASE_PATH)}`);
} finally {
  handle.sqlite.close();
}
