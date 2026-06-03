import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../testing.js';

describe('GET /api/health', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await buildTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns 200 + { status: ok } without authentication', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    // Public route — it must not mint or require a session.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 503 + { status: error } when the database is unreachable', async () => {
    // Drop the underlying SQLite connection so the `select 1` ping throws.
    testApp.dbHandle.close();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error' });
  });
});
