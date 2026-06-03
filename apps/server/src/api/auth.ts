// Opaque 256-bit DB-backed token in a signed cookie (the token is the security; the signature is tamper detection); sliding refresh, server-side revoke.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { SessionStore } from './sessionStore.js';
import { SESSION_TTL_MS } from './sessionStore.js';

export const SESSION_COOKIE_NAME = 'tg_feed_session';

export interface WebAuth {
  password: string;
  sessionSecret: string;
}

export interface TelegramAuth {
  botToken: string;
  adminIds: string[];
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
  // Reject empty: SHA-256('')==SHA-256('') would grant entry.
  if (!plain || !expected) return false;
  // Hash both first so password length isn't a timing signal.
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
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
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

// Unwraps the signed cookie only; the DB check is verifyAndRefresh.
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  if (!result.valid || typeof result.value !== 'string' || result.value.length === 0) {
    return null;
  }
  return result.value;
}

export function makeRequireAuth(sessionStore: SessionStore) {
  return async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = readSessionToken(request);
    if (!token) throw new UnauthorizedError();
    if (!sessionStore.verifyAndRefresh(token)) {
      throw new UnauthorizedError();
    }
  };
}
