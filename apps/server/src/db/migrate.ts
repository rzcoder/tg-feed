/**
 * Apply pending drizzle migrations to the configured DATABASE_PATH.
 *
 * Invoked via `pnpm db:migrate`. Idempotent — drizzle tracks applied
 * migrations in `__drizzle_migrations__`, so re-running is a no-op.
 */
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
  // SQLite table-recreation migrations (the recipe for column drops + FK
  // changes) require FKs disabled around the rename — otherwise CASCADE
  // and SET NULL fire when the old table is dropped, wiping referencing
  // rows. drizzle's migrate() wraps in a transaction where `PRAGMA
  // foreign_keys` is a no-op, so we have to set it here. The
  // `foreign_key_check` afterwards verifies the migration left no
  // orphans before we re-enable enforcement.
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
