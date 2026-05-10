/**
 * Per-workspace test environments.
 *
 * Server + shared tests run in node; web tests run in jsdom. Defining
 * the projects here lets `vitest run` from the repo root pick the right
 * environment per file.
 */
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './apps/server/vitest.config.ts',
  './apps/web/vitest.config.ts',
  './packages/shared/vitest.config.ts',
]);
