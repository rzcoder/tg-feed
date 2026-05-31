import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILTER_RULE_TYPES } from '@tg-feed/shared';
import { subscriptionFilters, subscriptions, type Subscription } from '../../db/schema.js';
import { buildTestApp, seedDestination, type TestApp } from '../testing.js';

interface FilterDtoLike {
  id: number;
  subscriptionId: number;
  ruleType: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

function seedSubscription(testApp: TestApp): Subscription {
  const inserted = testApp.db
    .insert(subscriptions)
    .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: seedDestination(testApp.db) })
    .returning()
    .all();
  return inserted[0]!;
}

describe('GET /api/filters/catalog', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns all 6 v1 rules with type and label', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/filters/catalog',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { type: string; label: string }[] };
    expect(body.items).toHaveLength(6);
    const types = body.items.map((i) => i.type).sort();
    expect(types).toEqual([...FILTER_RULE_TYPES].sort());
    for (const item of body.items) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('returns 401 without cookie', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/filters/catalog',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('subscription filter routes', () => {
  let testApp: TestApp;
  let cookie: string;
  let sub: Subscription;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    sub = seedSubscription(testApp);
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('GET filters returns empty list when none attached', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: `/api/subscriptions/${sub.id}/filters`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('GET filters returns 404 for unknown subscription', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/subscriptions/9999/filters',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST filter accepts a valid text-contains body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${sub.id}/filters`,
      headers: { cookie },
      payload: {
        ruleType: 'text-contains',
        params: { value: 'hello' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as FilterDtoLike;
    expect(body.subscriptionId).toBe(sub.id);
    expect(body.ruleType).toBe('text-contains');
    expect(body.params).toMatchObject({ value: 'hello', caseInsensitive: true });
    expect(body.enabled).toBe(true);
  });

  it('POST filter rejects text-contains with missing value', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${sub.id}/filters`,
      headers: { cookie },
      payload: { ruleType: 'text-contains', params: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST filter rejects unknown ruleType', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${sub.id}/filters`,
      headers: { cookie },
      payload: { ruleType: 'no-such-rule', params: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST filter on unknown subscription returns 404', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/9999/filters',
      headers: { cookie },
      payload: { ruleType: 'has-media', params: { required: true } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH filter updates enabled without touching params', async () => {
    const inserted = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: sub.id,
        ruleType: 'has-media',
        params: { required: true },
      })
      .returning()
      .all();
    const filterId = inserted[0]!.id;

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${sub.id}/filters/${filterId}`,
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FilterDtoLike;
    expect(body.enabled).toBe(false);
    expect(body.params).toMatchObject({ required: true });
  });

  it('PATCH filter validates new params against existing ruleType', async () => {
    const inserted = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: sub.id,
        ruleType: 'min-length',
        params: { min: 10 },
      })
      .returning()
      .all();
    const filterId = inserted[0]!.id;

    // Wrong shape for min-length (no `min` field)
    const bad = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${sub.id}/filters/${filterId}`,
      headers: { cookie },
      payload: { params: { value: 'foo' } },
    });
    expect(bad.statusCode).toBe(400);

    // Correct shape
    const good = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${sub.id}/filters/${filterId}`,
      headers: { cookie },
      payload: { params: { min: 20 } },
    });
    expect(good.statusCode).toBe(200);
    const body = good.json() as FilterDtoLike;
    expect(body.params).toEqual({ min: 20 });
  });

  it('PATCH filter returns 404 when filter belongs to a different subscription', async () => {
    const otherSub = testApp.db
      .insert(subscriptions)
      .values({
        sourceChatId: 'b',
        sourceTitle: 'B',
        destinationId: seedDestination(testApp.db, { name: 'b-dest', chatId: '-1008888888888' }),
      })
      .returning()
      .all()[0]!;
    const filter = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: otherSub.id,
        ruleType: 'has-media',
        params: { required: true },
      })
      .returning()
      .all()[0]!;

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${sub.id}/filters/${filter.id}`,
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH filter rejects empty body', async () => {
    const inserted = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: sub.id,
        ruleType: 'has-media',
        params: { required: true },
      })
      .returning()
      .all();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${sub.id}/filters/${inserted[0]!.id}`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE filter returns 204 and removes the row', async () => {
    const inserted = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: sub.id,
        ruleType: 'has-media',
        params: { required: true },
      })
      .returning()
      .all();
    const filterId = inserted[0]!.id;

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subscriptions/${sub.id}/filters/${filterId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    const remaining = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.id, filterId))
      .all();
    expect(remaining).toHaveLength(0);
  });

  it('DELETE filter returns 404 for cross-sub access', async () => {
    const otherSub = testApp.db
      .insert(subscriptions)
      .values({
        sourceChatId: 'b',
        sourceTitle: 'B',
        destinationId: seedDestination(testApp.db, { name: 'b-dest', chatId: '-1008888888888' }),
      })
      .returning()
      .all()[0]!;
    const filter = testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: otherSub.id,
        ruleType: 'has-media',
        params: { required: true },
      })
      .returning()
      .all()[0]!;

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subscriptions/${sub.id}/filters/${filter.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    // The filter still exists (under its real subscription)
    const stillThere = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.id, filter.id))
      .all();
    expect(stillThere).toHaveLength(1);
  });
});
