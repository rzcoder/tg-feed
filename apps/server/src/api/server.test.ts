import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './testing.js';

describe('createApiServer', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
  });

  afterEach(async () => {
    await testApp.close();
  });

  it('returns 404 for an unknown public route', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/no-such-route' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 for an authed route without a cookie', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized', message: 'unauthorized' } });
  });

  it('serves /api/me with a valid login cookie (cookie-signing roundtrip)', async () => {
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
  });

  it('returns 401 for tampered cookie value', async () => {
    const cookie = await testApp.loginAndGetCookie();
    // Mutate one byte in the signature portion
    const tampered = cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: tampered },
    });
    expect(res.statusCode).toBe(401);
  });
});
