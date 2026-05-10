import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DestinationDto } from '@tg-feed/shared';
import { destinations, subscriptions } from '../../db/schema.js';
import { buildTestApp, type TestApp } from '../testing.js';

describe('destination routes', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('GET /api/destinations returns empty list initially', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/destinations',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('POST /api/destinations creates and returns 201 with usageCount=0', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', chatId: '-1009374102931', note: 'primary' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as DestinationDto;
    expect(body).toMatchObject({
      name: 'ops',
      chatId: '-1009374102931',
      note: 'primary',
      usageCount: 0,
    });
    expect(typeof body.createdAt).toBe('string');
  });

  it('POST /api/destinations rejects non-numeric chatId', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', chatId: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/destinations rejects too-short numeric chatId', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', chatId: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/destinations carries usageCount via JOIN', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'ops', chatId: '-1001111111111' })
      .returning({ id: destinations.id })
      .all();
    testApp.db
      .insert(subscriptions)
      .values([
        { sourceChatId: 'a', sourceTitle: 'A', destinationId: d!.id },
        { sourceChatId: 'b', sourceTitle: 'B', destinationId: d!.id },
      ])
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/destinations',
      headers: { cookie },
    });
    const body = res.json() as { items: DestinationDto[] };
    expect(body.items[0]!.usageCount).toBe(2);
  });

  it('PATCH /api/destinations/:id updates name and note', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'old', chatId: '-1001111111111', note: null })
      .returning({ id: destinations.id })
      .all();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
      payload: { name: 'new', note: 'fresh note' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DestinationDto;
    expect(body.name).toBe('new');
    expect(body.note).toBe('fresh note');
  });

  it('PATCH /api/destinations/:id returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/destinations/9999',
      headers: { cookie },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/destinations/:id rejects empty body', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'x', chatId: '-1001111111111' })
      .returning({ id: destinations.id })
      .all();
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/destinations/:id returns 204 when unused', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'x', chatId: '-1001111111111' })
      .returning({ id: destinations.id })
      .all();
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const remaining = testApp.db.select().from(destinations).all();
    expect(remaining).toHaveLength(0);
  });

  it('DELETE /api/destinations/:id returns 409 destination_in_use when referenced', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'x', chatId: '-1001111111111' })
      .returning({ id: destinations.id })
      .all();
    testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'a', sourceTitle: 'A', destinationId: d!.id })
      .run();

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'destination_in_use' } });
    expect(testApp.db.select().from(destinations).all()).toHaveLength(1);
  });

  it('DELETE /api/destinations/:id returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/destinations/9999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['GET', '/api/destinations'],
    ['POST', '/api/destinations'],
    ['PATCH', '/api/destinations/1'],
    ['DELETE', '/api/destinations/1'],
  ])('%s %s returns 401 without cookie', async (method, url) => {
    const m = method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const res = await (m === 'POST' || m === 'PATCH'
      ? testApp.app.inject({ method: m, url, payload: {} })
      : testApp.app.inject({ method: m, url }));
    expect(res.statusCode).toBe(401);
  });
});
