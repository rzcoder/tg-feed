import { defineConfig } from 'drizzle-kit';

// drizzle-kit is a build-time CLI; the path here is only used by `db:studio`
// and the migration generator's diff target. The runtime DB path comes from
// `apps/server/src/config.ts` (DATABASE_PATH env). Hardcoded to keep this
// file env-free.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: './data/tg-feed.sqlite' },
  strict: true,
  verbose: true,
});
