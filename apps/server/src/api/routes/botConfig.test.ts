import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BotConfigInfo, ResolveBotAdminResponse } from '@tg-feed/shared';
import { parseConfig } from '../../config.js';
import { BOT_SETTINGS_KEY } from '../../db/botConfigRepo.js';
import { appSettings } from '../../db/schema.js';
import type { ChatResolveResult } from '../../tg/chatResolver.js';
import { buildTestApp, type TestApp } from '../testing.js';

const VALID_TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const OTHER_TOKEN = '654321:ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210';

const admin = (id: string, displayName: string | null = null, username: string | null = null) => ({
  id,
  displayName,
  username,
});

describe('bot config routes', () => {
  let testApp: TestApp;
  let cookie: string;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it('GET /api/config/bot rejects unauthenticated', async () => {
    testApp = await buildTestApp();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/config/bot' });
    expect(res.statusCode).toBe(401);
  });

  it('GET reports env-sourced config and running state', async () => {
    testApp = await buildTestApp({
      cfg: parseConfig({ TG_BOT_TOKEN: VALID_TOKEN, TG_BOT_ADMIN_IDS: '111' }),
      getBotRunning: () => true,
    });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/config/bot',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BotConfigInfo;
    expect(body.tokenConfigured).toBe(true);
    expect(body.tokenSource).toBe('env');
    expect(body.admins).toEqual([admin('111')]);
    expect(body.adminsSource).toBe('env');
    expect(body.encryptionKeyConfigured).toBe(false);
    expect(body.botRunning).toBe(true);
    // The token value must never appear in the masked response.
    expect(res.body).not.toContain(VALID_TOKEN);
  });

  it('PUT refuses a token write with 412 when no encryption key is configured', async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: { token: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.code).toBe('encryption_key_missing');
  });

  it('PUT stores an encrypted token, reports db source, and reloads the bot', async () => {
    const key = randomBytes(32);
    const reloadBot = vi.fn(async () => {});
    testApp = await buildTestApp({ getEncryptionKey: () => key, reloadBot });
    cookie = await testApp.loginAndGetCookie();

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: { token: VALID_TOKEN, admins: [admin('111', 'Jane', 'jane')] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BotConfigInfo;
    expect(body.tokenSource).toBe('db');
    expect(body.adminsSource).toBe('db');
    expect(body.admins).toEqual([admin('111', 'Jane', 'jane')]);
    expect(reloadBot).toHaveBeenCalledTimes(1);

    // Stored at rest as ciphertext — never the plaintext token.
    const row = testApp.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, BOT_SETTINGS_KEY))
      .get();
    expect(JSON.stringify(row?.value)).not.toContain(VALID_TOKEN);
  });

  it('PUT accepts admins + publicUrl without an encryption key', async () => {
    const reloadBot = vi.fn(async () => {});
    testApp = await buildTestApp({ reloadBot });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: {
        admins: [admin('111', 'Jane', 'jane'), admin('222')],
        publicUrl: 'https://x.example.com',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BotConfigInfo;
    expect(body.admins.map((a) => a.id)).toEqual(['111', '222']);
    expect(body.adminsSource).toBe('db');
    expect(body.publicUrl).toBe('https://x.example.com');
    expect(body.publicUrlSource).toBe('db');
    expect(reloadBot).toHaveBeenCalledTimes(1);
  });

  it('PUT merges partial updates across requests', async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: { admins: [admin('111')] },
    });
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: { publicUrl: 'https://y.example.com' },
    });
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/config/bot',
      headers: { cookie },
    });
    const body = res.json() as BotConfigInfo;
    expect(body.admins).toEqual([admin('111')]);
    expect(body.publicUrl).toBe('https://y.example.com');
  });

  it('PUT rejects an empty body, non-numeric admin ids, and a malformed token', async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    const payloads = [{}, { admins: [admin('abc')] }, { token: 'not-a-token' }];
    for (const payload of payloads) {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/config/bot',
        headers: { cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('DELETE clears stored config, reloads the bot, and falls back to env', async () => {
    const key = randomBytes(32);
    const reloadBot = vi.fn(async () => {});
    testApp = await buildTestApp({
      cfg: parseConfig({ TG_BOT_TOKEN: OTHER_TOKEN, TG_BOT_ADMIN_IDS: '111' }),
      getEncryptionKey: () => key,
      reloadBot,
    });
    cookie = await testApp.loginAndGetCookie();

    // Store a DB token (wins over env).
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/config/bot',
      headers: { cookie },
      payload: { token: VALID_TOKEN },
    });
    const afterPut = (
      await testApp.app.inject({ method: 'GET', url: '/api/config/bot', headers: { cookie } })
    ).json() as BotConfigInfo;
    expect(afterPut.tokenSource).toBe('db');

    const del = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/config/bot',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect(reloadBot).toHaveBeenCalledTimes(2); // once for the PUT, once for the DELETE

    const afterDelete = (
      await testApp.app.inject({ method: 'GET', url: '/api/config/bot', headers: { cookie } })
    ).json() as BotConfigInfo;
    expect(afterDelete.tokenSource).toBe('env'); // env fallback resumes
  });

  // --- resolve-admin (lookup by @username) ---------------------------------

  const userResolver = (chatId: string): ((input: string) => Promise<ChatResolveResult>) => {
    return async () => ({
      chatId,
      title: 'Jane Doe',
      handle: '@jane',
      inviteHash: null,
      alreadyMember: true,
    });
  };

  it('POST resolve-admin returns the user for a @username', async () => {
    testApp = await buildTestApp({ chatResolver: userResolver('777888999') });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/config/bot/resolve-admin',
      headers: { cookie },
      payload: { query: '@jane' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ResolveBotAdminResponse;
    expect(body).toEqual({ id: '777888999', displayName: 'Jane Doe', username: 'jane' });
  });

  it('POST resolve-admin rejects a channel/group with 422', async () => {
    testApp = await buildTestApp({ chatResolver: userResolver('-1001234567890') });
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/config/bot/resolve-admin',
      headers: { cookie },
      payload: { query: '@somechannel' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('not_a_user');
  });

  it('POST resolve-admin returns 503 when the resolver is unavailable', async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/config/bot/resolve-admin',
      headers: { cookie },
      payload: { query: '@jane' },
    });
    expect(res.statusCode).toBe(503);
  });
});
