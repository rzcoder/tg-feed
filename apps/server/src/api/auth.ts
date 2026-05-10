/**
 * Auth primitives for the API server.
 *
 * Single-user model: a successful `POST /api/auth/login` sets a signed
 * cookie whose value is `'1'`. The signature is the security; the value
 * carries no info. Subsequent requests pass the auth pre-handler if and
 * only if the cookie is present, the signature verifies (against
 * `SESSION_SECRET`), and the value still equals `'1'` after unsigning.
 *
 * `requireWebAuthEnv` parallels `tg/client.ts#requireTelegramEnv`. Both
 * `WEB_PASSWORD` and `SESSION_SECRET` stay `.optional()` in `config.ts`
 * so `pnpm db:migrate` and `pnpm tg:login` can run without them; only
 * the server boot path requires them.
 *
 * `verifyPassword` hashes both inputs to a fixed-size SHA-256 digest
 * before `timingSafeEqual` so password length isn't observable as a
 * timing signal and the equal-length precondition is automatic.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { UnauthorizedError } from '../lib/errors.js';

export const SESSION_COOKIE_NAME = 'tg_feed_session';
export const SESSION_COOKIE_VALUE = '1';
// 7 days — short enough to limit damage from a leaked cookie, long enough
// that a single-user operator isn't re-authing daily.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface WebAuth {
  password: string;
  sessionSecret: string;
}

export function requireWebAuthEnv(cfg: Config): WebAuth {
  const missing: string[] = [];
  if (!cfg.WEB_PASSWORD) missing.push('WEB_PASSWORD');
  if (!cfg.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `Missing required web auth env vars: ${missing.join(', ')}. ` +
        `WEB_PASSWORD gates the API; SESSION_SECRET signs cookies (min 32 chars).`,
    );
  }
  return {
    password: cfg.WEB_PASSWORD as string,
    sessionSecret: cfg.SESSION_SECRET as string,
  };
}

export function verifyPassword(plain: string, expected: string): boolean {
  const a = createHash('sha256').update(plain).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function signedCookieOptions(isProd: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    signed: true,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function clearedCookieOptions(isProd: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/',
  };
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) throw new UnauthorizedError();
  const result = request.unsignCookie(raw);
  if (!result.valid || result.value !== SESSION_COOKIE_VALUE) {
    throw new UnauthorizedError();
  }
}
