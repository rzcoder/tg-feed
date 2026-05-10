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
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TelegramStatus } from '@tg-feed/shared';
import type { Db } from '../db/client.js';
import type { EventBus } from '../events/bus.js';
import type { FilterRegistry } from '../filters/registry.js';
import type { Logger } from '../lib/logger.js';
import type { EntityResolver } from '../tg/entityResolver.js';
import { requireAuth, type WebAuth } from './auth.js';
import { makeErrorHandler } from './errorHandler.js';
import { registerAuthRoutes, registerLoginRoute } from './routes/auth.js';
import { registerDestinationRoutes } from './routes/destinations.js';
import { registerFilterRoutes } from './routes/filters.js';
import { registerForwardLogRoutes } from './routes/forwardLog.js';
import { registerLibraryFilterRoutes } from './routes/libraryFilters.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerSubscriptionRoutes } from './routes/subscriptions.js';
import { registerSystemRoutes } from './routes/system.js';

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
  bus: EventBus;
  /** Override the SSE heartbeat interval — primarily for tests. */
  heartbeatMs?: number;
  /**
   * gramjs-backed resolver for `POST /api/subscriptions/resolve`. Optional
   * because the API can boot in test/migrate-only modes without Telegram
   * env; the route returns 503 `telegram_unavailable` when missing.
   */
  entityResolver?: EntityResolver;
  /**
   * Snapshot of Telegram subsystem state captured at boot. Surfaced via
   * `GET /api/system/status` so the web UI can warn the operator when
   * Telegram is unavailable. Optional for tests; defaults to a generic
   * "not initialized" reason when absent.
   */
  telegramStatus?: TelegramStatus;
}

const DEFAULT_TELEGRAM_STATUS: TelegramStatus = {
  connected: false,
  reason: 'Telegram client not initialized',
};

export async function createApiServer(deps: CreateApiServerDeps): Promise<FastifyInstance> {
  const { db, logger, filterRegistry, webAuth, isProd, bus, heartbeatMs, entityResolver } = deps;
  const telegramStatus = deps.telegramStatus ?? DEFAULT_TELEGRAM_STATUS;

  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES });

  await app.register(fastifyCookie, { secret: webAuth.sessionSecret });

  // Helmet adds standard security headers (X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy, etc.). CSP is disabled because the SPA bundle includes inline
  // scripts/styles from Vite — enabling CSP without per-build nonces breaks it.
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // Register rate-limit globally with `global: false` so only routes that opt
  // in via `config.rateLimit` are throttled. The login route uses this; other
  // routes (single-user, behind auth cookie) don't need it.
  await app.register(fastifyRateLimit, { global: false });

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
      registerLoginRoute(publicScope, { webAuth, isProd, logger });
    },
    { prefix: '/api' },
  );

  // Authed scope — Fastify encapsulation scopes the preHandler to the
  // routes registered inside this plugin only. No per-route opt-in.
  await app.register(
    async (authedScope) => {
      authedScope.addHook('preHandler', requireAuth);
      registerAuthRoutes(authedScope, { isProd });
      registerDestinationRoutes(authedScope, { db });
      registerLibraryFilterRoutes(authedScope, { db });
      registerSubscriptionRoutes(authedScope, {
        db,
        bus,
        ...(entityResolver !== undefined ? { entityResolver } : {}),
      });
      registerFilterRoutes(authedScope, { db, filterRegistry });
      registerSettingsRoutes(authedScope, { db });
      registerForwardLogRoutes(authedScope, { db });
      registerStreamRoutes(authedScope, {
        bus,
        ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
      });
      registerSystemRoutes(authedScope, { telegramStatus });
    },
    { prefix: '/api' },
  );

  return app;
}
