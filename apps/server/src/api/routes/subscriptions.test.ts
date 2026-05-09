import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscriptionFilters, subscriptions } from '../../db/schema.js';
import { buildTestApp, type TestApp } from '../testing.js';

interface SubscriptionDtoLike {
  id: number;
  sourceChatId: string;
  sourceTitle: string;
  destinationChatId: string;
  enabled: boolean;
  createdAt: string;
}

describe('subscription routes', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('GET /api/subscriptions returns empty list on fresh DB', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('GET /api/subscriptions returns inserted rows ordered by id ASC', async () => {
    testApp.db
      .insert(subscriptions)
      .values([
        { sourceChatId: 'a', sourceTitle: 'A', destinationChatId: 'd' },
        { sourceChatId: 'b', sourceTitle: 'B', destinationChatId: 'd' },
      ])
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { cookie },
    });
    const body = res.json() as { items: SubscriptionDtoLike[] };
    expect(body.items.map((i) => i.sourceTitle)).toEqual(['A', 'B']);
    expect(body.items[0]!.id).toBeLessThan(body.items[1]!.id);
  });

  it('POST /api/subscriptions creates a row with enabled=true by default', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100SOURCE',
        sourceTitle: 'My Channel',
        destinationChatId: '-100DEST',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as SubscriptionDtoLike;
    expect(body).toMatchObject({
      sourceChatId: '-100SOURCE',
      sourceTitle: 'My Channel',
      destinationChatId: '-100DEST',
      enabled: true,
    });
    expect(body.id).toBeGreaterThan(0);
    expect(typeof body.createdAt).toBe('string');
  });

  it('POST /api/subscriptions honors explicit enabled: false', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100SOURCE',
        sourceTitle: 'My Channel',
        destinationChatId: '-100DEST',
        enabled: false,
      },
    });
    const body = res.json() as SubscriptionDtoLike;
    expect(body.enabled).toBe(false);
  });

  it('POST /api/subscriptions returns 400 with issues on missing field', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: { sourceTitle: 'X' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; issues: unknown[] } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it('PATCH /api/subscriptions/:id updates a single field', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'old', destinationChatId: 'd' })
      .returning()
      .all();
    const id = inserted[0]!.id;
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${id}`,
      headers: { cookie },
      payload: { sourceTitle: 'new' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SubscriptionDtoLike;
    expect(body.sourceTitle).toBe('new');
    expect(body.sourceChatId).toBe('a'); // unchanged
  });

  it('PATCH /api/subscriptions/:id returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/subscriptions/9999',
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('PATCH /api/subscriptions/:id rejects empty body', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationChatId: 'd' })
      .returning()
      .all();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${inserted[0]!.id}`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/subscriptions/:id returns 204 and cascades filters', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationChatId: 'd' })
      .returning()
      .all();
    const subId = inserted[0]!.id;
    testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: subId,
        ruleType: 'has-media',
        params: { required: true },
      })
      .run();

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subscriptions/${subId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    const remainingSubs = testApp.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subId))
      .all();
    expect(remainingSubs).toHaveLength(0);
    const remainingFilters = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.subscriptionId, subId))
      .all();
    expect(remainingFilters).toHaveLength(0);
  });

  it('DELETE /api/subscriptions/:id returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/subscriptions/9999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['GET', '/api/subscriptions'],
    ['POST', '/api/subscriptions'],
    ['PATCH', '/api/subscriptions/1'],
    ['DELETE', '/api/subscriptions/1'],
  ])('%s %s returns 401 without cookie', async (method, url) => {
    const res = await testApp.app.inject({
      method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url,
      payload: method === 'POST' || method === 'PATCH' ? {} : undefined,
    });
    expect(res.statusCode).toBe(401);
  });
});
