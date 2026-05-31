/**
 * API test scaffolding.
 *
 * Builds an isolated app instance backed by an in-memory DB and a fixed
 * test `webAuth`. Returns a `loginAndGetCookie()` helper because cookie
 * signing requires the live secret — tests can't fabricate a valid signed
 * cookie without going through the real login route.
 */
import type { FastifyInstance } from 'fastify';
import type { TelegramStatus } from '@tg-feed/shared';
import type { Db } from '../db/client.js';
import { destinations } from '../db/schema.js';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { createEventBus, type EventBus } from '../events/bus.js';
import { createDefaultRegistry } from '../filters/rules/index.js';
import { createLogger } from '../lib/logger.js';
import type { ChatResolver } from '../tg/chatResolver.js';
import type { ImportInviteFn } from '../tg/inviteResolver.js';
import type { JoinChannelFn } from '../tg/joinChannel.js';
import type { ProfilePhotoFetcher } from '../tg/profilePhoto.js';
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
  bus: EventBus;
  loginAndGetCookie(): Promise<string>;
  close(): Promise<void>;
}

export interface BuildTestAppOptions {
  /** Override the SSE heartbeat interval (default 25 s — too long for stream tests). */
  heartbeatMs?: number;
  /** Stub for the universal chat resolver used by both /resolve endpoints. */
  chatResolver?: ChatResolver;
  /** Stub for the invite-import hook used by both /create endpoints when `inviteHash` is provided. */
  importInvite?: ImportInviteFn;
  /** Stub for the auto-join hook fired from POST /api/subscriptions (chatId path). */
  joinChannel?: JoinChannelFn;
  /** Stub for the best-effort profile photo fetcher fired from both /create endpoints. */
  fetchProfilePhoto?: ProfilePhotoFetcher;
  /**
   * Override the Telegram status surfaced via `GET /api/system/status` and
   * used by routes to choose between `telegram_initializing` (transient,
   * during boot) and `telegram_unavailable` (steady-state). Defaults to a
   * disconnected status so tests that omit Telegram stubs see the
   * configure-style 503.
   */
  telegramStatus?: TelegramStatus;
  /**
   * Returns the configured `TG_SESSION_ENCRYPTION_KEY` as a 32-byte Buffer,
   * or null. Used by tests that exercise the export/import telegram-account
   * flow. Defaults to undefined (key absent).
   */
  getEncryptionKey?: () => Buffer | null;
  /**
   * Override the SPA static root. Lets the SPA-history-fallback tests point
   * the server at a temp dir containing a stub index.html.
   */
  webDistRoot?: string;
}

const DEFAULT_TEST_TELEGRAM_STATUS: TelegramStatus = {
  state: 'disconnected',
  connected: false,
  reason: 'test',
};

export async function buildTestApp(options: BuildTestAppOptions = {}): Promise<TestApp> {
  const dbHandle = createTestDb();
  const filterRegistry = createDefaultRegistry();
  const logger = createLogger({ silent: true });
  const bus = createEventBus({ logger });
  const status = options.telegramStatus ?? DEFAULT_TEST_TELEGRAM_STATUS;
  const app = await createApiServer({
    db: dbHandle.db,
    logger,
    filterRegistry,
    webAuth: TEST_WEB_AUTH,
    isProd: false,
    bus,
    getTelegramStatus: () => status,
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.chatResolver !== undefined ? { getChatResolver: () => options.chatResolver } : {}),
    ...(options.importInvite !== undefined ? { getImportInvite: () => options.importInvite } : {}),
    ...(options.joinChannel !== undefined ? { getJoinChannel: () => options.joinChannel } : {}),
    ...(options.fetchProfilePhoto !== undefined
      ? { getFetchProfilePhoto: () => options.fetchProfilePhoto }
      : {}),
    ...(options.getEncryptionKey !== undefined
      ? { getEncryptionKey: options.getEncryptionKey }
      : {}),
    ...(options.webDistRoot !== undefined ? { webDistRoot: options.webDistRoot } : {}),
  });

  return {
    app,
    db: dbHandle.db,
    dbHandle,
    bus,
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

/**
 * Insert a destination row and return its id. Most route tests need a
 * destination to attach subscriptions to.
 */
export function seedDestination(
  db: Db,
  overrides: { name?: string; chatId?: string; note?: string | null } = {},
): number {
  const inserted = db
    .insert(destinations)
    .values({
      name: overrides.name ?? 'test-dest',
      chatId: overrides.chatId ?? '-1009999999999',
      note: overrides.note ?? null,
    })
    .returning({ id: destinations.id })
    .all();
  return inserted[0]!.id;
}
