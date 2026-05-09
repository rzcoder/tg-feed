import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, TEST_PASSWORD, type TestApp } from '../testing.js';

describe('POST /api/auth/login', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await buildTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns 200 + Set-Cookie + body on correct password', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
    expect(res.headers['set-cookie']).toMatch(/tg_feed_session=/);
  });

  it('returns 401 + no cookie on wrong password', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 400 on empty body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 400 on empty password string', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/me', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await buildTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns 401 without cookie', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with valid cookie', async () => {
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
  });
});

describe('POST /api/auth/logout', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await buildTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns 401 without cookie (logout is auth-gated)', async () => {
    const res = await testApp.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
  });

  it('clears the cookie when called with a valid session', async () => {
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    // Cleared cookies have an empty value and a past Expires date
    expect(header).toMatch(/tg_feed_session=;/);
  });
});
