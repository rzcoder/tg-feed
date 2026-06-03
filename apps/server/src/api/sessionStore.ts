// Opaque session tokens in an HMAC-signed cookie; sliding 7-day expiry, server-side revoke.
import { randomBytes } from 'node:crypto';
import { lt, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webSessions } from '../db/schema.js';

const TOKEN_BYTES = 32;
// Hard cap even with sliding refresh, so an abandoned cookie still ages out.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionStore {
  create(now?: Date): string;
  // Slides expiry on hit; deletes expired rows in passing.
  verifyAndRefresh(token: string, now?: Date): boolean;
  revoke(token: string): boolean;
  prune(now?: Date): number;
}

export interface CreateSessionStoreDeps {
  db: Db;
  ttlMs?: number; // override for tests
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
