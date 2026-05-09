/**
 * Apply pending drizzle migrations to the configured DATABASE_PATH.
 *
 * Invoked via `pnpm db:migrate`. Idempotent — drizzle tracks applied
 * migrations in `__drizzle_migrations__`, so re-running is a no-op.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, resolveDatabasePath } from './client.js';
import { config } from '../config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, '../../drizzle');

const handle = createDb(config.DATABASE_PATH);
try {
  migrate(handle.db, { migrationsFolder });
  console.log(`migrations applied → ${resolveDatabasePath(config.DATABASE_PATH)}`);
} finally {
  handle.sqlite.close();
}
