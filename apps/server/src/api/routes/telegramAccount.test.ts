import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { TelegramAccountInfo, TelegramStatus } from '@tg-feed/shared';
import { telegramAccount } from '../../db/schema.js';
import { encryptSessionString, getKeyFingerprint } from '../../lib/sessionCrypto.js';
import { buildTestApp, type TestApp } from '../testing.js';

const CONNECTED: TelegramStatus = { state: 'connected', connected: true };

describe('telegram account routes', () => {
  let testApp: TestApp;
  let cookie: string;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it('GET /api/tg/account rejects unauthenticated', async () => {
    testApp = await buildTestApp();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/tg/account' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/tg/account reports key not configured + no row', async () => {
    testApp = await buildTestApp({ telegramStatus: CONNECTED });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TelegramAccountInfo;
    expect(body.encryptionKeyConfigured).toBe(false);
    expect(body.keyFingerprintMismatch).toBe(false);
    // Connected via env fallback.
    expect(body.source).toBe('env');
    expect(body.present).toBe(true);
  });

  it('GET /api/tg/account returns DB-source account when row + matching key + connected', async () => {
    const key = randomBytes(32);
    testApp = await buildTestApp({
      telegramStatus: CONNECTED,
      getEncryptionKey: () => key,
    });
    cookie = await testApp.loginAndGetCookie();
    const env = encryptSessionString('SESSION', key);
    const now = new Date();
    testApp.db
      .insert(telegramAccount)
      .values({
        id: 1,
        encryptedSessionString: env.ciphertext,
        keyFingerprint: env.keyFingerprint,
        phoneNumber: '+15550001111',
        displayName: 'Test User',
        username: 'tester',
        telegramUserId: '7',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TelegramAccountInfo;
    expect(body.source).toBe('db');
    expect(body.displayName).toBe('Test User');
    expect(body.username).toBe('tester');
    expect(body.encryptionKeyConfigured).toBe(true);
    expect(body.keyFingerprintMismatch).toBe(false);
  });

  it('GET /api/tg/account returns the self avatar and caches it across requests', async () => {
    const key = randomBytes(32);
    let calls = 0;
    let lastChatId: string | null = null;
    testApp = await buildTestApp({
      telegramStatus: CONNECTED,
      getEncryptionKey: () => key,
      fetchProfilePhoto: async (chatId) => {
        calls += 1;
        lastChatId = chatId;
        return 'data:image/jpeg;base64,AAAA';
      },
    });
    cookie = await testApp.loginAndGetCookie();
    const env = encryptSessionString('SESSION', key);
    const now = new Date();
    testApp.db
      .insert(telegramAccount)
      .values({
        id: 1,
        encryptedSessionString: env.ciphertext,
        keyFingerprint: env.keyFingerprint,
        phoneNumber: null,
        displayName: 'Avatar User',
        username: null,
        telegramUserId: '7',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const first = await testApp.app.inject({
      method: 'GET',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect((first.json() as TelegramAccountInfo).avatarDataUrl).toBe('data:image/jpeg;base64,AAAA');
    expect(lastChatId).toBe('me');

    const second = await testApp.app.inject({
      method: 'GET',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect((second.json() as TelegramAccountInfo).avatarDataUrl).toBe(
      'data:image/jpeg;base64,AAAA',
    );
    // Downloaded once, then served from the in-memory cache.
    expect(calls).toBe(1);
  });

  it('GET /api/tg/account flags key fingerprint mismatch when row encrypted by another key', async () => {
    const exportedKey = randomBytes(32);
    const localKey = randomBytes(32);
    testApp = await buildTestApp({
      telegramStatus: CONNECTED,
      getEncryptionKey: () => localKey,
    });
    cookie = await testApp.loginAndGetCookie();
    const now = new Date();
    testApp.db
      .insert(telegramAccount)
      .values({
        id: 1,
        encryptedSessionString: 'whatever',
        keyFingerprint: getKeyFingerprint(exportedKey),
        phoneNumber: null,
        displayName: 'Stale',
        username: null,
        telegramUserId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TelegramAccountInfo;
    expect(body.keyFingerprintMismatch).toBe(true);
    expect(body.source).toBe('env');
    // displayName comes from the row only when usable; mismatched rows
    // surface as anonymous so the UI focuses on the resolution prompt.
    expect(body.displayName).toBeNull();
  });

  it('POST /api/tg/login/start refuses with 412 when no encryption key is configured', async () => {
    testApp = await buildTestApp({ telegramStatus: CONNECTED });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tg/login/start',
      headers: { cookie },
      payload: { phoneNumber: '+15550001111' },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.code).toBe('encryption_key_missing');
  });

  it('POST /api/tg/login/raw refuses with 412 when no encryption key is configured', async () => {
    testApp = await buildTestApp({ telegramStatus: CONNECTED });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tg/login/raw',
      headers: { cookie },
      payload: { sessionString: 'aaaaaaaaaa' },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.code).toBe('encryption_key_missing');
  });

  it('DELETE /api/tg/account removes the row idempotently', async () => {
    const key = randomBytes(32);
    testApp = await buildTestApp({
      telegramStatus: CONNECTED,
      getEncryptionKey: () => key,
    });
    cookie = await testApp.loginAndGetCookie();
    const env = encryptSessionString('SESSION', key);
    const now = new Date();
    testApp.db
      .insert(telegramAccount)
      .values({
        id: 1,
        encryptedSessionString: env.ciphertext,
        keyFingerprint: env.keyFingerprint,
        phoneNumber: null,
        displayName: null,
        username: null,
        telegramUserId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const first = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(testApp.db.select().from(telegramAccount).all()).toHaveLength(0);

    // Idempotent: a second delete still 200s.
    const second = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/tg/account',
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
  });

  it('POST /api/tg/login/cancel ignores unknown sessionId without throwing', async () => {
    testApp = await buildTestApp({ telegramStatus: CONNECTED });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tg/login/cancel',
      headers: { cookie },
      payload: { sessionId: 'deadbeef' },
    });
    // No store wired in this test app (loginSessionStore is undefined),
    // so the route should refuse cleanly with 503.
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('login_session_store_unavailable');
  });
});
