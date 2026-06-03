// loginAndGetCookie() goes through the real login route: cookie signing needs the live secret.
import type { FastifyInstance } from 'fastify';
import type { TelegramStatus } from '@tg-feed/shared';
import { type Config } from '../config.js';
import type { Db } from '../db/client.js';
import { destinations } from '../db/schema.js';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { createEventBus, type EventBus } from '../events/bus.js';
import { createDefaultRegistry } from '../filters/rules/index.js';
import { createLogger } from '../lib/logger.js';
import type { ChatResolver } from '../tg/chatResolver.js';
import type { ForumTopicLister } from '../tg/forumTopics.js';
import type { ImportInviteFn } from '../tg/inviteResolver.js';
import type { JoinChannelFn } from '../tg/joinChannel.js';
import type { ProfilePhotoFetcher } from '../tg/profilePhoto.js';
import { type TelegramAuth, type WebAuth } from './auth.js';
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
  // Default 25 s — too long for stream tests.
  heartbeatMs?: number;
  chatResolver?: ChatResolver;
  importInvite?: ImportInviteFn;
  joinChannel?: JoinChannelFn;
  fetchProfilePhoto?: ProfilePhotoFetcher;
  listForumTopics?: ForumTopicLister;
  // Default disconnected, so tests without Telegram stubs see the configure-style 503.
  telegramStatus?: TelegramStatus;
  // Default undefined (key absent).
  getEncryptionKey?: () => Buffer | null;
  webDistRoot?: string;
  // Default undefined → POST /api/auth/telegram reports telegram_auth_disabled.
  telegramAuth?: TelegramAuth | null;
  cfg?: Config;
  reloadBot?: () => Promise<void>;
  getBotRunning?: () => boolean;
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
    ...(options.listForumTopics !== undefined
      ? { getListForumTopics: () => options.listForumTopics }
      : {}),
    ...(options.getEncryptionKey !== undefined
      ? { getEncryptionKey: options.getEncryptionKey }
      : {}),
    ...(options.webDistRoot !== undefined ? { webDistRoot: options.webDistRoot } : {}),
    ...(options.telegramAuth !== undefined
      ? { getTelegramAuth: () => options.telegramAuth ?? null }
      : {}),
    ...(options.cfg !== undefined ? { cfg: options.cfg } : {}),
    ...(options.reloadBot !== undefined ? { reloadBot: options.reloadBot } : {}),
    ...(options.getBotRunning !== undefined ? { getBotRunning: options.getBotRunning } : {}),
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
      // Just the name=value pair; clients echo that, not the attributes.
      return cookieHeader.split(';')[0]!;
    },
    async close() {
      await app.close();
      dbHandle.close();
    },
  };
}

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
