/**
 * Singleton DB client.
 *
 * App code uses `getDb()`. Tests use `createDb(':memory:')` directly via the
 * helper in `./testing.ts` and never touch the singleton.
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: BetterSqlite3Database;
}

let cachedProjectRoot: string | undefined;
function projectRoot(): string {
  if (cachedProjectRoot) return cachedProjectRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // Walk up looking for the workspace marker; pnpm-workspace.yaml is a
  // stable anchor across both `src/` (tsx) and `dist/` (node) layouts.
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedProjectRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }
  cachedProjectRoot = process.cwd();
  return cachedProjectRoot;
}

export function resolveDatabasePath(p: string): string {
  if (p === ':memory:' || path.isAbsolute(p)) return p;
  return path.resolve(projectRoot(), p);
}

export function createDb(databasePath: string): DbHandle {
  const resolved = resolveDatabasePath(databasePath);
  if (resolved !== ':memory:') {
    mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const sqlite = new Database(resolved);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

let singleton: DbHandle | undefined;

export function getDb(): Db {
  if (!singleton) {
    singleton = createDb(config.DATABASE_PATH);
  }
  return singleton.db;
}

export function closeDb(): void {
  singleton?.sqlite.close();
  singleton = undefined;
}
