/**
 * API test scaffolding.
 *
 * Builds an isolated app instance backed by an in-memory DB and a fixed
 * test `webAuth`. Returns a `loginAndGetCookie()` helper because cookie
 * signing requires the live secret — tests can't fabricate a valid signed
 * cookie without going through the real login route.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { createDefaultRegistry } from '../filters/rules/index.js';
import { createLogger } from '../lib/logger.js';
import { type WebAuth } from './auth.js';
import { createApiServer } from './server.js';

export const TEST_PASSWORD = 'test-password';
export const TEST_SESSION_SECRET = 'a'.repeat(32);

export const TEST_WEB_AUTH: WebAuth = {
  password: TEST_PASSWORD,
  sessionSecret: TEST_SESSION_SECRET,
};

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  dbHandle: TestDbHandle;
  loginAndGetCookie(): Promise<string>;
  close(): Promise<void>;
}

export async function buildTestApp(): Promise<TestApp> {
  const dbHandle = createTestDb();
  const filterRegistry = createDefaultRegistry();
  const logger = createLogger({ silent: true });
  const app = await createApiServer({
    db: dbHandle.db,
    logger,
    filterRegistry,
    webAuth: TEST_WEB_AUTH,
    isProd: false,
  });

  return {
    app,
    db: dbHandle.db,
    dbHandle,
    async loginAndGetCookie() {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
      if (res.statusCode !== 200) {
        throw new Error(`login failed in test setup: ${res.statusCode} ${res.body}`);
      }
      const setCookie = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      if (!cookieHeader) throw new Error('login response missing Set-Cookie header');
      // Pick out just the `name=value` portion before the first `;` —
      // attributes (Path, HttpOnly, ...) aren't sent back on subsequent
      // requests; clients just echo the cookie value.
      return cookieHeader.split(';')[0]!;
    },
    async close() {
      await app.close();
      dbHandle.close();
    },
  };
}
