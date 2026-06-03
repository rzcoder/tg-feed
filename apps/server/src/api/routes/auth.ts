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
      // Brute-force limit on the password, per real client IP; reset on success below so only failures count.
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
      // Reset the rate-limit bucket for this IP on success so only failures count.
      try {
        const rl = (request as FastifyRequest & { rateLimit?: () => Promise<unknown> }).rateLimit;
        if (typeof rl === 'function') await rl();
      } catch {
        // Plugin not loaded (test path with custom server).
      }
      const token = deps.sessionStore.create();
      reply.setCookie(SESSION_COOKIE_NAME, token, signedCookieOptions(deps.isProd));
      const response: LoginResponse = { authenticated: true };
      return response;
    },
  );
}

// Max accepted age of a Mini App initData payload on the auth route.
const TELEGRAM_INITDATA_MAX_AGE_SEC = 5 * 60;

export interface RegisterTelegramAuthDeps {
  // read per request (DB-over-env) so a Settings → Bot change applies without a restart; null when unconfigured
  getTelegramAuth: () => TelegramAuth | null;
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
      // Rate-limit this unauthenticated session-minting route; reset on success below.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const telegramAuth = deps.getTelegramAuth();
      if (!telegramAuth) {
        // Feature off — the SPA falls back to password login.
        throw new AppError(
          503,
          'telegram_auth_disabled',
          'Telegram Web App login is not configured on this server',
        );
      }

      const body = telegramAuthRequestSchema.parse(request.body);
      // Cap initData age at 5 min (the verifier default is 24h).
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

      // Reset the rate-limit bucket for this IP on success.
      try {
        const rl = (request as FastifyRequest & { rateLimit?: () => Promise<unknown> }).rateLimit;
        if (typeof rl === 'function') await rl();
      } catch {
        // Plugin not loaded (test path with custom server).
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
    // Deleting the server-side row is what invalidates the session; the cookie bytes stay valid until expiry.
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
