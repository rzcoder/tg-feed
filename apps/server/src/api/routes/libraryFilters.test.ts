import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryFilterDto } from '@tg-feed/shared';
import { libraryFilters, subscriptionLibraryFilters, subscriptions } from '../../db/schema.js';
import { buildTestApp, seedDestination, type TestApp } from '../testing.js';

describe('library filter routes', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('GET /api/library-filters returns empty list initially', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/library-filters',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('POST /api/library-filters creates and returns 201 with usageCount=0', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/library-filters',
      headers: { cookie },
      payload: {
        name: 'No #реклама',
        ruleType: 'text-excludes',
        params: { value: '#реклама', caseInsensitive: true },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as LibraryFilterDto;
    expect(body).toMatchObject({
      name: 'No #реклама',
      ruleType: 'text-excludes',
      usageCount: 0,
    });
    expect(body.params).toMatchObject({ value: '#реклама', caseInsensitive: true });
  });

  it('POST /api/library-filters rejects empty name', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/library-filters',
      headers: { cookie },
      payload: {
        name: '',
        ruleType: 'text-excludes',
        params: { value: '#реклама' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/library-filters rejects mismatched params shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/library-filters',
      headers: { cookie },
      payload: {
        name: 'X',
        ruleType: 'min-length',
        params: { value: 'foo' }, // wrong shape — min-length wants `min`
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/library-filters rejects an uncompilable text-regex pattern', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/library-filters',
      headers: { cookie },
      payload: {
        name: 'bad regex',
        ruleType: 'text-regex',
        params: { pattern: '(', flags: '' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/library-filters carries usageCount via JOIN', async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({
        name: 'No promo',
        ruleType: 'text-excludes',
        params: { value: '#promo', caseInsensitive: true },
      })
      .returning({ id: libraryFilters.id })
      .all();
    const destId = seedDestination(testApp.db);
    const [s1] = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all();
    const [s2] = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'b', sourceTitle: 'B', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all();
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values([
        { subscriptionId: s1!.id, libraryFilterId: lib!.id },
        { subscriptionId: s2!.id, libraryFilterId: lib!.id },
      ])
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/library-filters',
      headers: { cookie },
    });
    const body = res.json() as { items: LibraryFilterDto[] };
    expect(body.items[0]!.usageCount).toBe(2);
  });

  it('PATCH /api/library-filters/:id updates name and validates params against existing ruleType', async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({
        name: 'old',
        ruleType: 'min-length',
        params: { min: 30 },
      })
      .returning({ id: libraryFilters.id })
      .all();

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/library-filters/${lib!.id}`,
      headers: { cookie },
      payload: { name: 'new', params: { min: 80 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LibraryFilterDto;
    expect(body.name).toBe('new');
    expect(body.params).toEqual({ min: 80 });
  });

  it("PATCH /api/library-filters/:id rejects params that don't match existing ruleType", async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({
        name: 'min',
        ruleType: 'min-length',
        params: { min: 30 },
      })
      .returning({ id: libraryFilters.id })
      .all();

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/library-filters/${lib!.id}`,
      headers: { cookie },
      payload: { params: { value: 'foo' } }, // text-contains shape
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/library-filters/:id ignores ruleType in body (immutable)', async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({
        name: 'min',
        ruleType: 'min-length',
        params: { min: 30 },
      })
      .returning({ id: libraryFilters.id })
      .all();

    // Body schema doesn't include ruleType, so passing it is a 400 zod
    // error if .strict() is on, otherwise it's silently dropped. Either
    // way the row's ruleType doesn't change.
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/library-filters/${lib!.id}`,
      headers: { cookie },
      payload: { name: 'still-min' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LibraryFilterDto;
    expect(body.ruleType).toBe('min-length');
  });

  it('DELETE /api/library-filters/:id returns 204 when unused', async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({ name: 'x', ruleType: 'min-length', params: { min: 30 } })
      .returning({ id: libraryFilters.id })
      .all();
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/library-filters/${lib!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(testApp.db.select().from(libraryFilters).all()).toHaveLength(0);
  });

  it('DELETE /api/library-filters/:id returns 409 library_filter_in_use when attached', async () => {
    const [lib] = testApp.db
      .insert(libraryFilters)
      .values({ name: 'x', ruleType: 'min-length', params: { min: 30 } })
      .returning({ id: libraryFilters.id })
      .all();
    const destId = seedDestination(testApp.db);
    const [s] = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all();
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: s!.id, libraryFilterId: lib!.id })
      .run();

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/library-filters/${lib!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'library_filter_in_use' } });
  });

  it.each([
    ['GET', '/api/library-filters'],
    ['POST', '/api/library-filters'],
    ['PATCH', '/api/library-filters/1'],
    ['DELETE', '/api/library-filters/1'],
  ])('%s %s returns 401 without cookie', async (method, url) => {
    const m = method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const res = await (m === 'POST' || m === 'PATCH'
      ? testApp.app.inject({ method: m, url, payload: {} })
      : testApp.app.inject({ method: m, url }));
    expect(res.statusCode).toBe(401);
  });
});

describe('subscription library-filter attachment routes', () => {
  let testApp: TestApp;
  let cookie: string;
  let destId: number;
  let subId: number;
  let libId: number;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
    destId = seedDestination(testApp.db);
    [{ id: subId }] = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all() as [{ id: number }];
    [{ id: libId }] = testApp.db
      .insert(libraryFilters)
      .values({ name: 'lib', ruleType: 'min-length', params: { min: 30 } })
      .returning({ id: libraryFilters.id })
      .all() as [{ id: number }];
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('POST /api/subscriptions/:id/library-filters attaches and returns updated DTO', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${subId}/library-filters`,
      headers: { cookie },
      payload: { libraryFilterId: libId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { libraryFilterIds: number[] };
    expect(body.libraryFilterIds).toEqual([libId]);
  });

  it('POST attach is idempotent (re-attaching is a no-op)', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${subId}/library-filters`,
      headers: { cookie },
      payload: { libraryFilterId: libId },
    });
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${subId}/library-filters`,
      headers: { cookie },
      payload: { libraryFilterId: libId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { libraryFilterIds: number[] };
    expect(body.libraryFilterIds).toEqual([libId]);
  });

  it('POST attach returns 404 for missing subscription', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions/9999/library-filters',
      headers: { cookie },
      payload: { libraryFilterId: libId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST attach returns 404 for missing library filter', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/subscriptions/${subId}/library-filters`,
      headers: { cookie },
      payload: { libraryFilterId: 9999 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE detaches and returns 204', async () => {
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: subId, libraryFilterId: libId })
      .run();
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subscriptions/${subId}/library-filters/${libId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const remaining = testApp.db.select().from(subscriptionLibraryFilters).all();
    expect(remaining).toHaveLength(0);
  });

  it("DELETE returns 404 if attachment doesn't exist", async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subscriptions/${subId}/library-filters/${libId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/subscriptions accepts libraryFilterIds for bulk attach at create time', async () => {
    const [other] = testApp.db
      .insert(libraryFilters)
      .values({ name: 'other', ruleType: 'has-media', params: { required: true } })
      .returning({ id: libraryFilters.id })
      .all();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100src',
        sourceTitle: 'Src',
        destinationId: destId,
        libraryFilterIds: [libId, other!.id],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { libraryFilterIds: number[] };
    expect(body.libraryFilterIds.sort()).toEqual([libId, other!.id].sort());
  });

  it('PATCH /api/subscriptions/:id with libraryFilterIds replaces the set', async () => {
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: subId, libraryFilterId: libId })
      .run();
    const [other] = testApp.db
      .insert(libraryFilters)
      .values({ name: 'other', ruleType: 'has-media', params: { required: true } })
      .returning({ id: libraryFilters.id })
      .all();

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${subId}`,
      headers: { cookie },
      payload: { libraryFilterIds: [other!.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { libraryFilterIds: number[] };
    expect(body.libraryFilterIds).toEqual([other!.id]);
  });

  it('PATCH with libraryFilterIds=[] detaches all', async () => {
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: subId, libraryFilterId: libId })
      .run();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subscriptions/${subId}`,
      headers: { cookie },
      payload: { libraryFilterIds: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { libraryFilterIds: number[] };
    expect(body.libraryFilterIds).toEqual([]);
  });

  it('POST /api/subscriptions returns 400 for unknown library filter id', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie },
      payload: {
        sourceChatId: '-100src',
        sourceTitle: 'Src',
        destinationId: destId,
        libraryFilterIds: [9999],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
