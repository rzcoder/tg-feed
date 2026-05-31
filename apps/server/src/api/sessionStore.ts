/**
 * Per-login session token store.
 *
 * Cookie semantics changed (vs. the legacy static-value design):
 *   - The cookie value IS the opaque token. Server signs it with
 *     `@fastify/cookie` HMAC so a tampered cookie fails at unsign.
 *   - `create()` mints a 256-bit random token at login and inserts a row with
 *     a hard expiry.
 *   - `verifyAndRefresh()` is the requireAuth hot path: look up by token,
 *     reject if expired, otherwise bump `lastSeenAt` and slide `expiresAt`
 *     forward by the configured window. Sliding refresh limits damage from
 *     a stolen-but-unused cookie.
 *   - `revoke()` deletes the row — logout becomes immediate and definitive.
 *   - `prune()` purges expired rows; called periodically from boot.
 */
import { randomBytes } from 'node:crypto';
import { lt, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webSessions } from '../db/schema.js';

const TOKEN_BYTES = 32;
// 7 days hard cap; sliding window refreshes on each authed request, but a
// completely abandoned cookie still ages out.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionStore {
  /** Mint a new session. Returns the opaque token to send back in the cookie. */
  create(now?: Date): string;
  /**
   * Look up a token; if found and unexpired, slide `expiresAt` forward and
   * return true. Returns false for missing or expired tokens. Expired rows
   * are deleted in passing so the caller doesn't have to.
   */
  verifyAndRefresh(token: string, now?: Date): boolean;
  /** Delete a token. Idempotent — returns true if a row was deleted. */
  revoke(token: string): boolean;
  /** Sweep expired rows. Returns the number of rows deleted. */
  prune(now?: Date): number;
}

export interface CreateSessionStoreDeps {
  db: Db;
  /** Override TTL (tests). Defaults to 7 days. */
  ttlMs?: number;
}

export function createSessionStore(deps: CreateSessionStoreDeps): SessionStore {
  const { db } = deps;
  const ttlMs = deps.ttlMs ?? SESSION_TTL_MS;

  return {
    create(now = new Date()): string {
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const expiresAt = new Date(now.getTime() + ttlMs);
      db.insert(webSessions)
        .values({
          token,
          createdAt: now,
          expiresAt,
          lastSeenAt: now,
        })
        .run();
      return token;
    },

    verifyAndRefresh(token, now = new Date()): boolean {
      if (!token) return false;
      const row = db.select().from(webSessions).where(eq(webSessions.token, token)).get();
      if (!row) return false;
      if (row.expiresAt.getTime() <= now.getTime()) {
        // Expired — delete lazily so subsequent lookups don't reuse it.
        db.delete(webSessions).where(eq(webSessions.token, token)).run();
        return false;
      }
      const nextExpiresAt = new Date(now.getTime() + ttlMs);
      db.update(webSessions)
        .set({ lastSeenAt: now, expiresAt: nextExpiresAt })
        .where(eq(webSessions.token, token))
        .run();
      return true;
    },

    revoke(token): boolean {
      if (!token) return false;
      const result = db.delete(webSessions).where(eq(webSessions.token, token)).run();
      return result.changes > 0;
    },

    prune(now = new Date()): number {
      const result = db.delete(webSessions).where(lt(webSessions.expiresAt, now)).run();
      return result.changes;
    },
  };
}
