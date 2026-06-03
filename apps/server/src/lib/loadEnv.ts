// Walk up to the workspace-root .env (dotenv/config only checks cwd, which is apps/server under pnpm).
// Import this instead of dotenv/config from any entrypoint.
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
