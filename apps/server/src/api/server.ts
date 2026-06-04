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
import type { ForumTopicLister } from '../tg/forumTopics.js';
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
import { registerHealthRoute } from './routes/health.js';
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
  cfg?: Config;
  // Resolved DB-over-env; read per request by POST /api/auth/telegram so config changes apply live. null = password-only.
  getTelegramAuth?: () => TelegramAuth | null;
  reloadBot?: () => Promise<void>;
  getBotRunning?: () => boolean;
  isProd: boolean;
  bus: EventBus;
  heartbeatMs?: number;
  // Lazy: boot populates these after app.listen(), so handlers must deref per request, not at registration.
  getChatResolver?: () => ChatResolver | undefined;
  getImportInvite?: () => ImportInviteFn | undefined;
  getJoinChannel?: () => JoinChannelFn | undefined;
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
  getListForumTopics?: () => ForumTopicLister | undefined;
  // Read per request so 'connecting' → 'connected' transitions reach clients without a restart.
  getTelegramStatus?: () => TelegramStatus;
  getEncryptionKey?: () => Buffer | null;
  loginSessionStore?: LoginSessionStore;
  // Live-swaps the gramjs client + dependent runtime after sign-in/out, no restart.
  reloadTelegramSession?: () => Promise<void>;
  sessionStore?: SessionStore;
  webDistRoot?: string;
}

const DEFAULT_TELEGRAM_STATUS: TelegramStatus = {
  state: 'disconnected',
  connected: false,
  reason: 'Telegram client not initialized',
};

// sha256 of each inline <script> in built index.html for the CSP; [] when missing (dev) — prod MUST have the bundle.
function collectInlineScriptHashes(distRoot: string): string[] {
  try {
    const html = readFileSync(path.join(distRoot, 'index.html'), 'utf8');
    const hashes: string[] = [];
    // Inline scripts only (no src=); capture content exactly as served — that's what the browser hashes.
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
    getListForumTopics,
  } = deps;
  const getTelegramStatus =
    deps.getTelegramStatus ?? ((): TelegramStatus => DEFAULT_TELEGRAM_STATUS);
  const cfg = deps.cfg ?? parseConfig({});
  const getTelegramAuth = deps.getTelegramAuth ?? ((): TelegramAuth | null => null);
  // Only decides CSP frame-ancestors; enabling iframe embedding from fully-off needs a restart, Mini App auth is live.
  const bootTelegramAuth = getTelegramAuth();
  const distRoot = deps.webDistRoot ?? WEB_DIST_ROOT;

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Keys rate-limit + request.ip on the real client IP behind a proxy; deploys MUST forward X-Forwarded-For (DEPLOY.md).
    trustProxy: true,
  });

  await app.register(fastifyCookie, { secret: webAuth.sessionSecret });

  const sessionStore = deps.sessionStore ?? createSessionStore({ db });

  // CSP only in prod; dev's index.html has unknown HMR inline-script hashes.
  const inlineScriptHashes = isProd ? collectInlineScriptHashes(distRoot) : [];
  // frame-ancestors lets Telegram Web embed the console, only when the Mini App is configured.
  const telegramWebApp = !!bootTelegramAuth;
  const frameAncestors = telegramWebApp ? ["'self'", 'https://web.telegram.org'] : ["'none'"];
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            scriptSrc: ["'self'", ...inlineScriptHashes, 'https://telegram.org'],
            // unsafe-inline required: Vite's CSS pipeline emits inline styles for runtime theming.
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors,
            baseUri: ["'self'"],
          },
        }
      : false,
  });

  // global: false — only routes that opt in via config.rateLimit are throttled (the login route).
  await app.register(fastifyRateLimit, { global: false });

  if (!isProd) {
    await app.register(fastifyCors, {
      origin: ['http://localhost:5173'],
      credentials: true,
    });
  }

  // Plugin requires root to exist; create it so a SPA-less dev/test boot doesn't fail registration.
  mkdirSync(distRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: distRoot,
    prefix: '/',
    // deny: never serve a stray .env / .git/ that lands in the build (default 'allow' would).
    dotfiles: 'deny',
    index: ['index.html'],
  });

  // SPA history fallback: HTML-accepting GETs outside /api serve index.html so React Router resolves; everything else keeps the JSON 404.
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

  // Public scope — no requireAuth.
  await app.register(
    async (publicScope) => {
      registerHealthRoute(publicScope, { db, logger });
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

  // Authed scope — encapsulation scopes the preHandler to routes inside this plugin only.
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
        ...(getListForumTopics !== undefined ? { getListForumTopics } : {}),
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
        ...(deps.reloadBot !== undefined ? { reloadBot: deps.reloadBot } : {}),
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
        ...(getFetchProfilePhoto !== undefined ? { getFetchProfilePhoto } : {}),
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
