/**
 * Auth primitives for the API server.
 *
 * Single-user model. A successful `POST /api/auth/login` mints a fresh
 * opaque random token (256-bit, base64url), stores it in `web_sessions` with
 * an expiry, and sets a signed cookie carrying that token as the value.
 *
 * The signature exists for tamper detection; the *security* comes from the
 * token being unguessable and existing in the DB. Logout deletes the row,
 * so a leaked cookie can be revoked. Sliding refresh on each authed request
 * keeps the user signed in while limiting damage from a long-unused
 * captured cookie.
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
import type { SessionStore } from './sessionStore.js';
import { SESSION_TTL_MS } from './sessionStore.js';

export const SESSION_COOKIE_NAME = 'tg_feed_session';

export interface WebAuth {
  password: string;
  sessionSecret: string;
}

/** Bot token + admin allowlist for the Telegram Web App sign-in route. */
export interface TelegramAuth {
  botToken: string;
  adminIds: string[];
}

/** Returns the Telegram auth config, or null when the bot token / allowlist is unset. */
export function readTelegramAuth(cfg: Config): TelegramAuth | null {
  if (!cfg.TG_BOT_TOKEN || cfg.TG_BOT_ADMIN_IDS.length === 0) return null;
  return { botToken: cfg.TG_BOT_TOKEN, adminIds: cfg.TG_BOT_ADMIN_IDS };
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
  // Defensive: refuse to match empty/missing credentials even if upstream
  // validation lets them through. SHA-256 of '' is a deterministic constant —
  // without this guard, two empty strings would compare equal and grant entry.
  if (!plain || !expected) return false;
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

/**
 * Read a session token from the incoming signed cookie, or null if absent /
 * tampered. Does NOT verify against the DB — the auth pre-handler does that
 * via `sessionStore.verifyAndRefresh`.
 */
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  if (!result.valid || typeof result.value !== 'string' || result.value.length === 0) {
    return null;
  }
  return result.value;
}

/**
 * Build the Fastify pre-handler that enforces auth on a scoped route plugin.
 * The factory takes the session store so the pre-handler closes over a real
 * DB-backed lookup; tests build their own via `buildTestApp`.
 */
export function makeRequireAuth(sessionStore: SessionStore) {
  return async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = readSessionToken(request);
    if (!token) throw new UnauthorizedError();
    if (!sessionStore.verifyAndRefresh(token)) {
      throw new UnauthorizedError();
    }
  };
}
