import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appSettings } from '../../db/schema.js';
import {
  DEFAULT_DELAY_MS,
  GLOBAL_SETTINGS_KEY,
  getGlobalDelayMs,
} from '../../forwarding/throttle.js';
import { buildTestApp, type TestApp } from '../testing.js';

describe('settings routes', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('GET /api/settings returns the default delay when no row exists', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delayMs: DEFAULT_DELAY_MS });
  });

  it('PUT /api/settings inserts the row when missing', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { delayMs: 5000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delayMs: 5000 });

    const row = testApp.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, GLOBAL_SETTINGS_KEY))
      .get();
    expect(row?.value).toEqual({ delayMs: 5000 });
  });

  it('PUT /api/settings upserts when row already exists', async () => {
    testApp.db
      .insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value: { delayMs: 5000 } })
      .run();

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { delayMs: 12000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delayMs: 12000 });
  });

  it('GET reads back the value just written by PUT', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { delayMs: 7777 },
    });
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie },
    });
    expect(res.json()).toEqual({ delayMs: 7777 });
  });

  it('after PUT, getGlobalDelayMs reflects the new value (forwarding pipeline integration)', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { delayMs: 9999 },
    });
    expect(getGlobalDelayMs(testApp.db)).toBe(9999);
  });

  it('PUT /api/settings rejects delayMs of 0', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { delayMs: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/settings rejects missing delayMs', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['GET', '/api/settings', undefined],
    ['PUT', '/api/settings', { delayMs: 5000 }],
  ] as const)('%s %s returns 401 without cookie', async (method, url, payload) => {
    const res = await (payload === undefined
      ? testApp.app.inject({ method, url })
      : testApp.app.inject({ method, url, payload }));
    expect(res.statusCode).toBe(401);
  });
});
