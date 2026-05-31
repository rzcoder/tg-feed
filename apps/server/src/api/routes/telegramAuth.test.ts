import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TelegramAuth } from '../auth.js';
import { signInitData, TEST_BOT_TOKEN as BOT_TOKEN } from '../../bot/testing.js';
import { buildTestApp, type TestApp } from '../testing.js';

// A 64-bit-range admin id (> 2^53) doubles as a precision regression guard:
// the id is embedded as a raw JSON integer literal so the server must extract
// it from the text, not round-trip it through a lossy JS number.
const ADMIN_ID = '9007199254740993';
const TELEGRAM_AUTH: TelegramAuth = { botToken: BOT_TOKEN, adminIds: [ADMIN_ID] };

function initDataFor(userId: string): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${userId},"first_name":"Op"}`,
  });
}

describe('POST /api/auth/telegram', () => {
  describe('when configured', () => {
    let testApp: TestApp;
    beforeEach(async () => {
      testApp = await buildTestApp({ telegramAuth: TELEGRAM_AUTH });
    });
    afterEach(async () => {
      await testApp.close();
    });

    it('signs in an allowlisted admin and sets the session cookie', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: { initData: initDataFor(ADMIN_ID) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ authenticated: true });
      expect(res.headers['set-cookie']).toMatch(/tg_feed_session=/);
    });

    it('mints a session usable on authed routes', async () => {
      const login = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: { initData: initDataFor(ADMIN_ID) },
      });
      const setCookie = login.headers['set-cookie'];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
      const me = await testApp.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(me.statusCode).toBe(200);
    });

    it('rejects a non-allowlisted Telegram user with 401 + no cookie', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: { initData: initDataFor('9999') },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects a forged/tampered signature with 401', async () => {
      const tampered = initDataFor(ADMIN_ID).replace(/hash=[0-9a-f]+/, 'hash=' + 'd'.repeat(64));
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: { initData: tampered },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 on empty body', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('when not configured', () => {
    let testApp: TestApp;
    beforeEach(async () => {
      testApp = await buildTestApp();
    });
    afterEach(async () => {
      await testApp.close();
    });

    it('reports the feature as disabled (503)', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/telegram',
        payload: { initData: initDataFor(ADMIN_ID) },
      });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('telegram_auth_disabled');
    });
  });
});
