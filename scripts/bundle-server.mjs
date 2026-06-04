import { build } from 'esbuild';

// re2 + better-sqlite3 are native .node addons; pino loads transport workers
// from real files. None survive bundling, so they stay as runtime deps.
const external = ['re2', 'better-sqlite3', 'pino'];

// ESM output has no require/__dirname/__filename, but bundled CJS deps (dotenv,
// gramjs, …) expect them. Recreate them from import.meta.url.
const banner = {
  js: "import{createRequire as ___r}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___r(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);",
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  external,
  banner,
};

// Output paths keep each entry's original depth so its import.meta.url still
// resolves apps/web/dist (server) and apps/server/drizzle (migrate) by relative
// path at runtime.
await build({
  ...common,
  entryPoints: ['apps/server/dist/index.js'],
  outfile: 'apps/server/dist/api/index.bundle.js',
});
await build({
  ...common,
  entryPoints: ['apps/server/dist/db/migrate.js'],
  outfile: 'apps/server/dist/db/migrate.bundle.js',
});
