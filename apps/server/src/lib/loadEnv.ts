/**
 * Locate and load the workspace `.env` file.
 *
 * `dotenv/config` looks at `process.cwd() + '/.env'` only. In a pnpm
 * monorepo `pnpm -F @tg-feed/server dev` runs with cwd = `apps/server`,
 * which doesn't contain `.env` — so vars from the workspace-root `.env`
 * never load. Walking up from this module's directory finds the closest
 * `.env` regardless of cwd, so dev / migrate / tg:login all see the same
 * config.
 *
 * Import this module instead of `dotenv/config` from any entrypoint that
 * needs env vars before reading `process.env`.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findEnvFile(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envPath = findEnvFile();
loadDotenv(envPath ? { path: envPath } : undefined);
