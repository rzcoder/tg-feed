/**
 * Auth routes.
 *
 * Split between two registration functions — `registerLoginRoute` for
 * the unauthenticated `POST /api/auth/login`, and `registerAuthRoutes`
 * for the authed-scope `POST /api/auth/logout` and `GET /api/me`. The
 * factory wires each into the appropriate Fastify scope.
 *
 * Login mints an opaque random token (256-bit, base64url) via the session
 * store and sets it as the signed cookie value. Logout deletes the row, so
 * a leaked cookie is revoked on the server — not just cleared on the
 * client. The login-route rate limit only counts failed attempts so a
 * legitimate user mid-debugging doesn't burn the brute-force bucket.
 *
 * `registerTelegramAuthRoute` is the Mini-App counterpart of the password
 * login: it verifies a Telegram Web App `initData` payload and, if the
 * embedded user is on the admin allowlist, mints the same kind of session.
 * Both public routes share the session store, so a Telegram sign-in is
 * indistinguishable downstream from a password sign-in.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  loginRequestSchema,
  telegramAuthRequestSchema,
  type LoginResponse,
  type MeResponse,
} from '@tg-feed/shared';
import type { Logger } from '../../lib/logger.js';
import { AppError, UnauthorizedError } from '../../lib/errors.js';
import { verifyTelegramInitData } from '../../bot/initData.js';
import {
  SESSION_COOKIE_NAME,
  clearedCookieOptions,
  readSessionToken,
  signedCookieOptions,
  verifyPassword,
  type TelegramAuth,
  type WebAuth,
} from '../auth.js';
import type { SessionStore } from '../sessionStore.js';

export interface RegisterLoginDeps {
  webAuth: WebAuth;
  isProd: boolean;
  logger: Logger;
  sessionStore: SessionStore;
}

export function registerLoginRoute(app: FastifyInstance, deps: RegisterLoginDeps): void {
  app.post(
    '/auth/login',
    {
      // Rate-limit brute-force on the single-user password. Counted per IP
      // (trustProxy is enabled at the factory level so we key on the real
      // client IP behind a reverse proxy). `skipOnError: true` and the
      // `skipSuccessfulRequests`-equivalent below keep the bucket reserved
      // for failed attempts only.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);
      if (!verifyPassword(body.password, deps.webAuth.password)) {
        deps.logger.warn(
          { ip: request.ip, ua: request.headers['user-agent'] },
          'auth: failed login attempt',
        );
        throw new UnauthorizedError('invalid password');
      }
      // Successful login — reset the rate-limit bucket for this IP so a
      // legitimate operator who logged in mid-debugging doesn't get throttled
      // moments later. `request.rateLimit()` is provided by @fastify/rate-limit
      // when the route's `config.rateLimit` is set.
      try {
        const rl = (request as FastifyRequest & { rateLimit?: () => Promise<unknown> }).rateLimit;
        if (typeof rl === 'function') await rl();
      } catch {
        // Plugin not loaded (test path with custom server). Safe to ignore.
      }
      const token = deps.sessionStore.create();
      reply.setCookie(SESSION_COOKIE_NAME, token, signedCookieOptions(deps.isProd));
      const response: LoginResponse = { authenticated: true };
      return response;
    },
  );
}

// Max age accepted for a Mini App initData payload on the auth route. Short
// because the client posts it right after launch; bounds replay of a leak.
const TELEGRAM_INITDATA_MAX_AGE_SEC = 5 * 60;

export interface RegisterTelegramAuthDeps {
  /** Null when the bot token / admin allowlist isn't configured. */
  telegramAuth: TelegramAuth | null;
  isProd: boolean;
  logger: Logger;
  sessionStore: SessionStore;
}

export function registerTelegramAuthRoute(
  app: FastifyInstance,
  deps: RegisterTelegramAuthDeps,
): void {
  app.post(
    '/auth/telegram',
    {
      // Same brute-force posture as the password route — an unauthenticated
      // endpoint that mints sessions. The HMAC makes forgery infeasible, but
      // the limiter still bounds abuse (and is reset on success below).
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const { telegramAuth } = deps;
      if (!telegramAuth) {
        // Feature off (no bot token / admin ids). The SPA treats this as
        // "fall back to password" rather than a hard error.
        throw new AppError(
          503,
          'telegram_auth_disabled',
          'Telegram Web App login is not configured on this server',
        );
      }

      const body = telegramAuthRequestSchema.parse(request.body);
      // Tight freshness window: the web client posts initData immediately on
      // Mini App launch, so a valid payload is seconds old. Capping at 5 min
      // (vs. the verifier's lenient 24h default) shrinks the replay window for
      // any captured initData that mints a full admin session.
      const result = verifyTelegramInitData(body.initData, telegramAuth.botToken, {
        maxAgeSec: TELEGRAM_INITDATA_MAX_AGE_SEC,
      });
      if (!result.ok) {
        deps.logger.warn(
          { ip: request.ip, reason: result.reason },
          'auth: rejected Telegram Web App initData',
        );
        throw new UnauthorizedError('invalid Telegram authentication');
      }

      if (!telegramAuth.adminIds.includes(result.user.id)) {
        deps.logger.warn(
          { ip: request.ip, telegramUserId: result.user.id },
          'auth: Telegram user not on admin allowlist',
        );
        throw new UnauthorizedError('this Telegram account is not authorized');
      }

      // Reset the limiter for this IP on a successful sign-in (mirrors the
      // password route) so a legitimate admin isn't throttled after retries.
      try {
        const rl = (request as FastifyRequest & { rateLimit?: () => Promise<unknown> }).rateLimit;
        if (typeof rl === 'function') await rl();
      } catch {
        // Plugin not loaded (test path with custom server). Safe to ignore.
      }

      const token = deps.sessionStore.create();
      reply.setCookie(SESSION_COOKIE_NAME, token, signedCookieOptions(deps.isProd));
      deps.logger.info({ telegramUserId: result.user.id }, 'auth: Telegram Web App sign-in');
      const response: LoginResponse = { authenticated: true };
      return response;
    },
  );
}

export interface RegisterAuthDeps {
  isProd: boolean;
  sessionStore: SessionStore;
}

export function registerAuthRoutes(app: FastifyInstance, deps: RegisterAuthDeps): void {
  app.post('/auth/logout', async (request, reply) => {
    // Read the token from the signed cookie before clearing it; deleting the
    // server-side row is what actually invalidates the session (the cookie
    // bytes are otherwise still valid until they expire client-side).
    const token = readSessionToken(request);
    if (token) deps.sessionStore.revoke(token);
    reply.clearCookie(SESSION_COOKIE_NAME, clearedCookieOptions(deps.isProd));
    return {};
  });

  app.get('/me', async () => {
    const response: MeResponse = { authenticated: true };
    return response;
  });
}
