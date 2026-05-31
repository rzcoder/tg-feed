import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// Hard-reloading a client-side route (e.g. https://host/settings) hits the
// server with a real GET that has no matching route. Without a history
// fallback the operator gets `{"message":"Route GET:/settings not found",...}`
// instead of the app. These lock the fallback that serves index.html.
describe('SPA history fallback', () => {
  let distDir: string;
  let testApp: TestApp;
  const MARKER = '<div id="root"><!--spa-fallback-test--></div>';

  beforeEach(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'tgfeed-dist-'));
    writeFileSync(join(distDir, 'index.html'), `<!doctype html><title>tg-feed</title>${MARKER}`);
    testApp = await buildTestApp({ webDistRoot: distDir });
  });

  afterEach(async () => {
    await testApp.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('serves index.html for a deep client route on hard reload', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/settings',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(MARKER);
  });

  it('serves index.html for nested client routes with a query string', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/destinations?tab=invite',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(MARKER);
  });

  it('keeps a JSON 404 for unknown API routes even when the client accepts HTML', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/no-such-route',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ error: 'Not Found', statusCode: 404 });
  });

  it('does not serve HTML to non-browser (XHR / JSON) requests', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/settings',
      headers: { accept: 'application/json' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('does not serve HTML for non-GET methods', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/settings',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
