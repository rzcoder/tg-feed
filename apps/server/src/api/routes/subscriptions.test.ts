import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent, SubscriptionDto } from '@tg-feed/shared';
import { subscriptionFilters, subscriptions } from '../../db/schema.js';
import type { EntityResolver } from '../../tg/entityResolver.js';
import { NotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { buildTestApp, seedDestination, type TestApp } from '../testing.js';

describe('subscription routes', () => {
  let testApp: TestApp;
  let cookie: string;
  let busEvents: StreamEvent[];
  let destId: number;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    busEvents = [];
    testApp.bus.on((event) => {
      busEvents.push(event);
    });
    destId = seedDestination(testApp.db, { name: 'primary', chatId: '-1009999999999' });
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

  it('GET /api/subscriptions returns inserted rows ordered by id ASC, joined with destination', async () => {
    testApp.db
      .insert(subscriptions)
      .values([
        { sourceChatId: 'a', sourceTitle: 'A', destinationId: destId },
        { sourceChatId: 'b', sourceTitle: 'B', destinationId: destId },
      ])
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { cookie },
    });
    const body = res.json() as { items: SubscriptionDto[] };
    expect(body.items.map((i) => i.sourceTitle)).toEqual(['A', 'B']);
    expect(body.items[0]!.destinationName).toBe('primary');
    expect(body.items[0]!.destinationChatId).toBe('-1009999999999');
    expect(body.items[0]!.destinationId).toBe(destId);
    expect(body.items[0]!.filterCount).toBe(0);
    expect(body.items[0]!.forwardedCount).toBe(0);
  });

  it('POST /api/subscriptions creates a row with enabled=true by default', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100SOURCE',
        sourceTitle: 'My Channel',
        handle: '@my_channel',
        destinationId: destId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as SubscriptionDto;
    expect(body).toMatchObject({
      sourceChatId: '-100SOURCE',
      sourceTitle: 'My Channel',
      handle: '@my_channel',
      destinationId: destId,
      destinationName: 'primary',
      enabled: true,
    });
    expect(body.id).toBeGreaterThan(0);
    expect(typeof body.createdAt).toBe('string');
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]).toMatchObject({
      type: 'subscription.changed',
      change: 'created',
      subscriptionId: body.id,
    });
  });

  it('POST /api/subscriptions honors explicit enabled: false', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100SOURCE',
        sourceTitle: 'My Channel',
        destinationId: destId,
        enabled: false,
      },
    });
    const body = res.json() as SubscriptionDto;
    expect(body.enabled).toBe(false);
  });

  it('POST /api/subscriptions returns 400 for missing destinationId', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: { sourceChatId: 's', sourceTitle: 'X' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; issues: unknown[] } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.issues.length).toBeGreaterThan(0);
    expect(busEvents).toHaveLength(0);
  });

  it('POST /api/subscriptions returns 400 when destination does not exist', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: 's',
        sourceTitle: 'X',
        destinationId: 9999,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(busEvents).toHaveLength(0);
  });

  it('PATCH /api/subscriptions/:id updates a single field', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'old', destinationId: destId })
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
    const body = res.json() as SubscriptionDto;
    expect(body.sourceTitle).toBe('new');
    expect(body.sourceChatId).toBe('a'); // unchanged
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]).toMatchObject({
      type: 'subscription.changed',
      change: 'updated',
      subscriptionId: id,
    });
  });

  it('PATCH /api/subscriptions/:id can change destination', async () => {
    const otherDest = seedDestination(testApp.db, { name: 'logs', chatId: '-1008888888888' });
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning()
      .all();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${inserted[0]!.id}`,
      headers: { cookie },
      payload: { destinationId: otherDest },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SubscriptionDto;
    expect(body.destinationId).toBe(otherDest);
    expect(body.destinationName).toBe('logs');
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
    expect(busEvents).toHaveLength(0);
  });

  it('PATCH /api/subscriptions/:id rejects empty body', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
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
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
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
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]).toMatchObject({
      type: 'subscription.changed',
      change: 'deleted',
      subscriptionId: subId,
    });
  });

  it('DELETE /api/subscriptions/:id returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/subscriptions/9999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(busEvents).toHaveLength(0);
  });

  it.each([
    ['GET', '/api/subscriptions'],
    ['POST', '/api/subscriptions'],
    ['PATCH', '/api/subscriptions/1'],
    ['DELETE', '/api/subscriptions/1'],
  ])('%s %s returns 401 without cookie', async (method, url) => {
    const m = method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const res = await (m === 'POST' || m === 'PATCH'
      ? testApp.app.inject({ method: m, url, payload: {} })
      : testApp.app.inject({ method: m, url }));
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/subscriptions materializes inlineFilters in subscription_filters', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100src',
        sourceTitle: 'Src',
        destinationId: destId,
        inlineFilters: [
          { ruleType: 'text-contains', params: { value: 'release' } },
          { ruleType: 'min-length', params: { min: 20 }, enabled: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as SubscriptionDto;
    const rows = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.subscriptionId, body.id))
      .all();
    expect(rows).toHaveLength(2);
    const byType = Object.fromEntries(rows.map((r) => [r.ruleType, r]));
    expect(byType['text-contains']!.enabled).toBe(true);
    expect(byType['min-length']!.enabled).toBe(false);
    expect(body.filterCount).toBe(2);
  });

  it('POST /api/subscriptions returns 400 for inlineFilters with mismatched params', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100src',
        sourceTitle: 'Src',
        destinationId: destId,
        inlineFilters: [{ ruleType: 'text-contains', params: { min: 5 } }],
      },
    });
    expect(res.statusCode).toBe(400);
    const inserted = testApp.db.select().from(subscriptions).all();
    expect(inserted).toHaveLength(0);
    expect(busEvents).toHaveLength(0);
  });

  it('PATCH /api/subscriptions/:id with inlineFilters replaces the set', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning()
      .all();
    const subId = inserted[0]!.id;
    testApp.db
      .insert(subscriptionFilters)
      .values({ subscriptionId: subId, ruleType: 'has-media', params: { required: true } })
      .run();

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${subId}`,
      headers: { cookie },
      payload: {
        inlineFilters: [{ ruleType: 'text-regex', params: { pattern: 'foo', flags: 'i' } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.subscriptionId, subId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ruleType).toBe('text-regex');
  });

  it('PATCH /api/subscriptions/:id with inlineFilters=[] drops all', async () => {
    const inserted = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning()
      .all();
    const subId = inserted[0]!.id;
    testApp.db
      .insert(subscriptionFilters)
      .values({ subscriptionId: subId, ruleType: 'has-media', params: { required: true } })
      .run();

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${subId}`,
      headers: { cookie },
      payload: { inlineFilters: [] },
    });
    expect(res.statusCode).toBe(200);
    const rows = testApp.db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.subscriptionId, subId))
      .all();
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/subscriptions/resolve', () => {
  it('returns 503 telegram_unavailable when no resolver configured', async () => {
    const testApp = await buildTestApp();
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/resolve',
      headers: { cookie },
      payload: { input: 'foo' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'telegram_unavailable' } });
    await testApp.close();
  });

  it('forwards normalised input to the resolver and returns the response shape', async () => {
    const resolver = vi.fn<EntityResolver>().mockResolvedValue({
      sourceChatId: '-1001234567890',
      sourceTitle: 'Anthropic',
      handle: '@anthropic_ai',
    });
    const testApp = await buildTestApp({ entityResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/resolve',
      headers: { cookie },
      payload: { input: 'https://t.me/anthropic_ai' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sourceChatId: '-1001234567890',
      sourceTitle: 'Anthropic',
      handle: '@anthropic_ai',
    });
    expect(resolver).toHaveBeenCalledWith('https://t.me/anthropic_ai');
    await testApp.close();
  });

  it('maps NotFoundError → 404 unknown_channel', async () => {
    const resolver = vi.fn<EntityResolver>().mockRejectedValue(new NotFoundError('channel @x'));
    const testApp = await buildTestApp({ entityResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/resolve',
      headers: { cookie },
      payload: { input: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
    await testApp.close();
  });

  it('maps UpstreamError → 503 with the right code', async () => {
    const resolver = vi
      .fn<EntityResolver>()
      .mockRejectedValue(new UpstreamError('private', 'private_channel'));
    const testApp = await buildTestApp({ entityResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/resolve',
      headers: { cookie },
      payload: { input: 'x' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'private_channel' } });
    await testApp.close();
  });

  it('maps ValidationError → 400 (e.g. malformed input)', async () => {
    const resolver = vi
      .fn<EntityResolver>()
      .mockRejectedValue(new ValidationError('expected handle'));
    const testApp = await buildTestApp({ entityResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/resolve',
      headers: { cookie },
      payload: { input: '!!!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
    await testApp.close();
  });
});
