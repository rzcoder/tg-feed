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
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TelegramStatus } from '@tg-feed/shared';
import { parseConfig, type Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { EventBus } from '../events/bus.js';
import type { FilterRegistry } from '../filters/registry.js';
import type { Logger } from '../lib/logger.js';
import type { ChatResolver } from '../tg/chatResolver.js';
import type { ImportInviteFn } from '../tg/inviteResolver.js';
import type { JoinChannelFn } from '../tg/joinChannel.js';
import type { LoginSessionStore } from '../tg/loginSession.js';
import type { ProfilePhotoFetcher } from '../tg/profilePhoto.js';
import { makeRequireAuth, type TelegramAuth, type WebAuth } from './auth.js';
import { createSessionStore, type SessionStore } from './sessionStore.js';
import { makeErrorHandler } from './errorHandler.js';
import {
  registerAuthRoutes,
  registerLoginRoute,
  registerTelegramAuthRoute,
} from './routes/auth.js';
import { registerBotConfigRoutes } from './routes/botConfig.js';
import { registerDestinationRoutes } from './routes/destinations.js';
import { registerFilterRoutes } from './routes/filters.js';
import { registerForwardLogRoutes } from './routes/forwardLog.js';
import { registerLibraryFilterRoutes } from './routes/libraryFilters.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerSubscriptionRoutes } from './routes/subscriptions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTelegramAccountRoutes } from './routes/telegramAccount.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// `apps/server/src/api/server.ts` → repo root → `apps/web/dist`
const WEB_DIST_ROOT = path.resolve(moduleDir, '../../../web/dist');

const BODY_LIMIT_BYTES = 100 * 1024;

export interface CreateApiServerDeps {
  db: Db;
  logger: Logger;
  filterRegistry: FilterRegistry;
  webAuth: WebAuth;
  /**
   * Parsed env config — supplies the env fallbacks behind the bot-config
   * route's DB-over-env resolver. Optional for tests; defaults to a config
   * parsed from an empty env (all bot/web vars unset).
   */
  cfg?: Config;
  /**
   * Live getter for the Telegram Web App auth config (bot token + admin
   * allowlist), resolved DB-over-env. Read per request by
   * `POST /api/auth/telegram` so a config change made via Settings → Bot
   * applies without a restart. Read once at boot to decide whether to relax
   * the CSP `frame-ancestors` for the Mini App. Null/omitted (or a getter
   * that yields null) = password-only with the strict default CSP.
   */
  getTelegramAuth?: () => TelegramAuth | null;
  /**
   * Live-swaps the long-polling bot after a config change. Wired to the
   * bot-config route's PUT/DELETE. Optional for tests (no swap occurs).
   */
  reloadBot?: () => Promise<void>;
  /** Whether the long-polling bot is currently running (for the masked GET). */
  getBotRunning?: () => boolean;
  isProd: boolean;
  bus: EventBus;
  /** Override the SSE heartbeat interval — primarily for tests. */
  heartbeatMs?: number;
  /**
   * Lazy lookup for the universal "paste-anything" resolver used by
   * `POST /subscriptions/resolve` and `POST /destinations/resolve`. The
   * boot path in `apps/server/src/index.ts` populates this asynchronously
   * after `app.listen()` returns, so route handlers must dereference per
   * request rather than at registration time. Optional for tests and
   * Telegram-less boots; routes return 503 `telegram_unavailable` (or
   * `telegram_initializing` while `getTelegramStatus().state ===
   * 'connecting'`) when the getter yields undefined.
   */
  getChatResolver?: () => ChatResolver | undefined;
  /**
   * Lazy lookup for the `messages.ImportChatInvite` wrapper used by both
   * subscription and destination create endpoints when the body carries
   * `inviteHash`. Same lifecycle as `getChatResolver`.
   */
  getImportInvite?: () => ImportInviteFn | undefined;
  /**
   * Lazy lookup for the auto-join helper invoked from POST /subscriptions
   * after the row is inserted. Same lifecycle as `getChatResolver`; when
   * undefined, new subscriptions get the default 'ok' status and rely on
   * the access monitor's first sweep to correct it.
   */
  getJoinChannel?: () => JoinChannelFn | undefined;
  /**
   * Lazy lookup for the best-effort profile-photo fetcher used by both
   * create endpoints (`POST /subscriptions`, `POST /destinations`) to
   * populate the new row's `iconDataUrl` immediately. Same lifecycle as
   * `getChatResolver`; without it new rows stay icon-less until the access
   * monitor's lazy backfill catches them.
   */
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
  /**
   * Live getter for the Telegram subsystem state. Surfaced via
   * `GET /api/system/status` so the web UI can warn the operator when
   * Telegram is unavailable. The getter is read on each request, so the
   * boot path can flip 'connecting' → 'connected' (or the health monitor
   * can flip 'connected' → 'disconnected') and clients pick up the change
   * without a restart. Optional for tests; defaults to a generic "not
   * initialized" reason when absent.
   */
  getTelegramStatus?: () => TelegramStatus;
  /**
   * Returns the loaded `TG_SESSION_ENCRYPTION_KEY` as a 32-byte Buffer, or
   * null when the env var is not set. Used by the telegram-account routes
   * to refuse account writes when no key is configured, and by the system
   * import route to skip encrypted blobs whose fingerprint doesn't match.
   * Optional — when absent, both paths behave as if the key is unset.
   */
  getEncryptionKey?: () => Buffer | null;
  /**
   * In-memory store for in-progress sign-ins from the Settings page.
   * Optional — telegram-account routes return 503 when missing (for tests
   * that don't exercise the login flow).
   */
  loginSessionStore?: LoginSessionStore;
  /**
   * Triggers a live-swap of the gramjs client and dependent runtime
   * (pipeline, debouncer, monitors, resolvers). Called after a successful
   * sign-in or sign-out so the running app picks up the new credentials
   * without a restart. Optional for tests; in tests the routes still write
   * the row but no swap occurs.
   */
  reloadTelegramSession?: () => Promise<void>;
  /**
   * Optional override for the DB-backed session store. Defaults to
   * `createSessionStore({ db })`. Tests may inject a custom one but the
   * default is fine for both production and the standard test scaffolding.
   */
  sessionStore?: SessionStore;
  /**
   * Override the directory the SPA is served from (static root, CSP inline
   * hashes, and the history fallback below). Defaults to the built
   * `apps/web/dist`. Tests point this at a temp dir to exercise the SPA
   * fallback without a real web build.
   */
  webDistRoot?: string;
}

const DEFAULT_TELEGRAM_STATUS: TelegramStatus = {
  state: 'disconnected',
  connected: false,
  reason: 'Telegram client not initialized',
};

/**
 * Compute the sha256 hashes of every inline `<script>` tag found in the
 * built `apps/web/dist/index.html` so they can be added to the CSP. This
 * preserves the no-FOUC inline theme-bootstrap script while still pinning a
 * strict `script-src 'self' 'sha256-...'` policy.
 *
 * Tolerant: if the file is missing (dev mode) or contains no inline
 * scripts, returns []. The CSP just allows nothing inline in that case,
 * which is the right default — production deploys MUST have the bundle.
 */
function collectInlineScriptHashes(distRoot: string): string[] {
  try {
    const html = readFileSync(path.join(distRoot, 'index.html'), 'utf8');
    const hashes: string[] = [];
    // Match only inline scripts (no `src=` attribute). Capture the content
    // between the tags exactly as served — that's what the browser hashes.
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const content = match[1] ?? '';
      if (content.trim().length === 0) continue;
      const digest = createHash('sha256').update(content, 'utf8').digest('base64');
      hashes.push(`'sha256-${digest}'`);
    }
    return hashes;
  } catch {
    return [];
  }
}

export async function createApiServer(deps: CreateApiServerDeps): Promise<FastifyInstance> {
  const {
    db,
    logger,
    filterRegistry,
    webAuth,
    isProd,
    bus,
    heartbeatMs,
    getChatResolver,
    getImportInvite,
    getJoinChannel,
    getFetchProfilePhoto,
  } = deps;
  const getTelegramStatus =
    deps.getTelegramStatus ?? ((): TelegramStatus => DEFAULT_TELEGRAM_STATUS);
  const cfg = deps.cfg ?? parseConfig({});
  const getTelegramAuth = deps.getTelegramAuth ?? ((): TelegramAuth | null => null);
  // Resolved once at boot — used only to decide the CSP frame-ancestors. The
  // route itself reads the getter per request, so token/admin changes apply
  // live; toggling the bot from fully-off to on still needs a restart for the
  // in-Telegram iframe embedding (the CSP), but the Mini App auth works live.
  const bootTelegramAuth = getTelegramAuth();
  const distRoot = deps.webDistRoot ?? WEB_DIST_ROOT;

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Required for the login rate-limit (and `request.ip` everywhere) to key
    // on the real client IP behind a reverse proxy / Docker NAT / CDN. Deploys
    // MUST terminate TLS upstream and forward X-Forwarded-For; see DEPLOY.md.
    trustProxy: true,
  });

  await app.register(fastifyCookie, { secret: webAuth.sessionSecret });

  // DB-backed session store. Cookies carry an opaque token; this is the
  // server-side lookup that actually decides whether a request is authed.
  const sessionStore = deps.sessionStore ?? createSessionStore({ db });

  // Helmet adds standard security headers (X-Content-Type-Options,
  // X-Frame-Options, Referrer-Policy, etc.). CSP is enabled in production
  // using the inline-script hash from the built `index.html`. In dev the
  // hash is unknown (Vite serves an unbuilt index.html with HMR scripts), so
  // CSP is left off there — same posture as before this change.
  const inlineScriptHashes = isProd ? collectInlineScriptHashes(distRoot) : [];
  // `index.html` always loads the `telegram-web-app.js` SDK, so `script-src`
  // always allows telegram.org. `frame-ancestors` lets Telegram Web embed the
  // console and is enabled only when the Mini App is configured; native
  // Telegram clients use a webview not subject to it.
  const telegramWebApp = !!bootTelegramAuth;
  const frameAncestors = telegramWebApp ? ["'self'", 'https://web.telegram.org'] : ["'none'"];
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            // `data:` covers profile-photo `<img>`s; inline hashes cover the
            // theme bootstrap script in `index.html`.
            imgSrc: ["'self'", 'data:'],
            scriptSrc: ["'self'", ...inlineScriptHashes, 'https://telegram.org'],
            // Vite's CSS pipeline emits some inline styles for runtime
            // theming; `'unsafe-inline'` for styleSrc is the standard
            // pragmatic carve-out.
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors,
            baseUri: ["'self'"],
            // `upgrade-insecure-requests` is on by default via `useDefaults`.
          },
        }
      : false,
  });

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
  // environments without a built SPA don't fail registration. Until a real
  // bundle exists the directory just stays empty.
  mkdirSync(distRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: distRoot,
    prefix: '/',
    // Refuse to serve dotfiles even if a stray `.env` / `.git/` ends up in
    // the build output — default is `'allow'` which would happily serve them.
    dotfiles: 'deny',
    index: ['index.html'],
  });

  // SPA history fallback. The web app routes on the client (React Router), so
  // a hard reload or shared deep link to e.g. /settings reaches the server as
  // a real `GET /settings` with no matching route. For browser navigations
  // (GET that accepts HTML, outside `/api`) serve index.html so the SPA boots
  // and resolves the route client-side. Everything else — API misses, and
  // asset/XHR requests that don't accept HTML — keeps the JSON 404 so clients
  // get a real error instead of a surprise HTML body.
  app.setNotFoundHandler((request, reply) => {
    const accept = request.headers.accept;
    const acceptsHtml = (Array.isArray(accept) ? accept.join(',') : (accept ?? '')).includes(
      'text/html',
    );
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (request.method === 'GET' && !isApi && acceptsHtml) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  app.setErrorHandler(makeErrorHandler(logger));

  // Public scope — password login + Telegram Web App sign-in, no `requireAuth`.
  await app.register(
    async (publicScope) => {
      registerLoginRoute(publicScope, { webAuth, isProd, logger, sessionStore });
      registerTelegramAuthRoute(publicScope, {
        getTelegramAuth,
        isProd,
        logger,
        sessionStore,
      });
    },
    { prefix: '/api' },
  );

  // Authed scope — Fastify encapsulation scopes the preHandler to the
  // routes registered inside this plugin only. No per-route opt-in.
  await app.register(
    async (authedScope) => {
      authedScope.addHook('preHandler', makeRequireAuth(sessionStore));
      registerAuthRoutes(authedScope, { isProd, sessionStore });
      registerDestinationRoutes(authedScope, {
        db,
        getTelegramStatus,
        ...(getChatResolver !== undefined ? { getChatResolver } : {}),
        ...(getImportInvite !== undefined ? { getImportInvite } : {}),
        ...(getFetchProfilePhoto !== undefined ? { getFetchProfilePhoto } : {}),
      });
      registerLibraryFilterRoutes(authedScope, { db });
      registerSubscriptionRoutes(authedScope, {
        db,
        bus,
        getTelegramStatus,
        ...(getChatResolver !== undefined ? { getChatResolver } : {}),
        ...(getImportInvite !== undefined ? { getImportInvite } : {}),
        ...(getJoinChannel !== undefined ? { getJoinChannel } : {}),
        ...(getFetchProfilePhoto !== undefined ? { getFetchProfilePhoto } : {}),
      });
      registerFilterRoutes(authedScope, { db, filterRegistry });
      registerSettingsRoutes(authedScope, { db });
      registerForwardLogRoutes(authedScope, { db });
      registerStreamRoutes(authedScope, {
        bus,
        ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
      });
      registerSystemRoutes(authedScope, {
        db,
        bus,
        logger,
        getTelegramStatus,
        ...(deps.getEncryptionKey !== undefined ? { getEncryptionKey: deps.getEncryptionKey } : {}),
        ...(deps.reloadTelegramSession !== undefined
          ? { reloadTelegramSession: deps.reloadTelegramSession }
          : {}),
        ...(getFetchProfilePhoto !== undefined ? { getFetchProfilePhoto } : {}),
      });
      registerTelegramAccountRoutes(authedScope, {
        db,
        ...(deps.getEncryptionKey !== undefined ? { getEncryptionKey: deps.getEncryptionKey } : {}),
        ...(deps.loginSessionStore !== undefined
          ? { loginSessionStore: deps.loginSessionStore }
          : {}),
        ...(deps.reloadTelegramSession !== undefined
          ? { reloadTelegramSession: deps.reloadTelegramSession }
          : {}),
        getTelegramStatus,
      });
      registerBotConfigRoutes(authedScope, {
        cfg,
        db,
        getTelegramStatus,
        ...(deps.getEncryptionKey !== undefined ? { getEncryptionKey: deps.getEncryptionKey } : {}),
        ...(deps.reloadBot !== undefined ? { reloadBot: deps.reloadBot } : {}),
        ...(deps.getBotRunning !== undefined ? { getBotRunning: deps.getBotRunning } : {}),
        ...(getChatResolver !== undefined ? { getChatResolver } : {}),
      });
    },
    { prefix: '/api' },
  );

  return app;
}
