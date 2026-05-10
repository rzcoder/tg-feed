/**
 * Auth routes.
 *
 * Split between two registration functions — `registerLoginRoute` for
 * the unauthenticated `POST /api/auth/login`, and `registerAuthRoutes`
 * for the authed-scope `POST /api/auth/logout` and `GET /api/me`. The
 * factory wires each into the appropriate Fastify scope.
 */
import type { FastifyInstance } from 'fastify';
import { loginRequestSchema, type LoginResponse, type MeResponse } from '@tg-feed/shared';
import type { Logger } from '../../lib/logger.js';
import { UnauthorizedError } from '../../lib/errors.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  clearedCookieOptions,
  signedCookieOptions,
  verifyPassword,
  type WebAuth,
} from '../auth.js';

export interface RegisterLoginDeps {
  webAuth: WebAuth;
  isProd: boolean;
  logger: Logger;
}

export function registerLoginRoute(app: FastifyInstance, deps: RegisterLoginDeps): void {
  app.post(
    '/auth/login',
    {
      // Rate-limit brute-force on the single-user password. Counted per IP;
      // legitimate users hit it once.
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
      reply.setCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, signedCookieOptions(deps.isProd));
      const response: LoginResponse = { authenticated: true };
      return response;
    },
  );
}

export interface RegisterAuthDeps {
  isProd: boolean;
}

export function registerAuthRoutes(app: FastifyInstance, deps: RegisterAuthDeps): void {
  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, clearedCookieOptions(deps.isProd));
    return {};
  });

  app.get('/me', async () => {
    const response: MeResponse = { authenticated: true };
    return response;
  });
}
