import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TelegramAuth } from '../auth.js';
import { buildTestApp, type TestApp } from '../testing.js';

const BOT_TOKEN = '123456:test-bot-token';
const ADMIN_ID = '4242';
const TELEGRAM_AUTH: TelegramAuth = { botToken: BOT_TOKEN, adminIds: [ADMIN_ID] };

/** Build a correctly-signed initData payload (same algorithm Telegram uses). */
function signInitData(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function initDataFor(userId: string): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(userId), first_name: 'Op' }),
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
