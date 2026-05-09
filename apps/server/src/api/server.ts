/**
 * Fastify factory.
 *
 * Pure factory — does NOT call `.listen()`. The boot path in
 * `apps/server/src/index.ts` constructs the app and calls listen; tests
 * construct the app and use `.inject()` directly. Same code, two
 * call sites.
 *
 * Plugin order:
 *   1. `@fastify/cookie` (signed cookies; secret = `webAuth.sessionSecret`)
 *   2. `@fastify/cors` — dev only (allow Vite at :5173). Production is
 *      same-origin via `@fastify/static`, so no CORS surface to expose.
 *   3. `@fastify/static` — serves `apps/web/dist` (no-op until Ch 9/14
 *      bundles a real SPA). The plugin requires the directory to exist;
 *      we `mkdirSync(root, { recursive: true })` on registration so it
 *      doesn't throw before the SPA lands.
 *   4. Custom error handler from `errorHandler.ts`
 *   5. Public scope (just `POST /api/auth/login`)
 *   6. Authed scope (`requireAuth` preHandler + everything else)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import type { FilterRegistry } from '../filters/registry.js';
import type { Logger } from '../lib/logger.js';
import { requireAuth, type WebAuth } from './auth.js';
import { makeErrorHandler } from './errorHandler.js';
import { registerAuthRoutes, registerLoginRoute } from './routes/auth.js';
import { registerFilterRoutes } from './routes/filters.js';
import { registerForwardLogRoutes } from './routes/forwardLog.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSubscriptionRoutes } from './routes/subscriptions.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// `apps/server/src/api/server.ts` → repo root → `apps/web/dist`
const WEB_DIST_ROOT = path.resolve(moduleDir, '../../../web/dist');

const BODY_LIMIT_BYTES = 100 * 1024;

export interface CreateApiServerDeps {
  db: Db;
  logger: Logger;
  filterRegistry: FilterRegistry;
  webAuth: WebAuth;
  isProd: boolean;
}

export async function createApiServer(deps: CreateApiServerDeps): Promise<FastifyInstance> {
  const { db, logger, filterRegistry, webAuth, isProd } = deps;

  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES });

  await app.register(fastifyCookie, { secret: webAuth.sessionSecret });

  if (!isProd) {
    await app.register(fastifyCors, {
      origin: ['http://localhost:5173'],
      credentials: true,
    });
  }

  // Plugin requires `root` to exist; create it if absent so dev/test
  // environments without a built SPA don't fail registration. Until
  // Ch 9/14 produce a real bundle the directory just stays empty and
  // every non-API path 404s.
  mkdirSync(WEB_DIST_ROOT, { recursive: true });
  await app.register(fastifyStatic, {
    root: WEB_DIST_ROOT,
    prefix: '/',
  });

  app.setErrorHandler(makeErrorHandler(logger));

  // Public scope — only the login route. No `requireAuth` preHandler.
  await app.register(
    async (publicScope) => {
      registerLoginRoute(publicScope, { webAuth, isProd });
    },
    { prefix: '/api' },
  );

  // Authed scope — Fastify encapsulation scopes the preHandler to the
  // routes registered inside this plugin only. No per-route opt-in.
  await app.register(
    async (authedScope) => {
      authedScope.addHook('preHandler', requireAuth);
      registerAuthRoutes(authedScope, { isProd });
      registerSubscriptionRoutes(authedScope, { db });
      registerFilterRoutes(authedScope, { db, filterRegistry });
      registerSettingsRoutes(authedScope, { db });
      registerForwardLogRoutes(authedScope, { db });
    },
    { prefix: '/api' },
  );

  return app;
}
