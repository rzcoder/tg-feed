import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forwardLog, subscriptions, type Subscription } from '../../db/schema.js';
import { buildTestApp, seedDestination, type TestApp } from '../testing.js';

interface ForwardLogEntryDtoLike {
  id: number;
  subscriptionId: number | null;
  subscriptionTitle: string | null;
  sourceHandle: string | null;
  destinationName: string | null;
  sourceMessageId: string;
  destMessageId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

function seedSub(
  testApp: TestApp,
  options: { title?: string; handle?: string | null; destinationId?: number | null } = {},
): Subscription {
  const title = options.title ?? 'A';
  const destinationId =
    options.destinationId === undefined ? seedDestination(testApp.db) : options.destinationId;
  return testApp.db
    .insert(subscriptions)
    .values({
      sourceChatId: 'a',
      sourceTitle: title,
      handle: options.handle ?? null,
      destinationId,
    })
    .returning()
    .all()[0]!;
}

describe('GET /api/forward-log', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('returns empty list on empty DB', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextOffset: null });
  });

  it('returns rows ordered by createdAt DESC, id DESC', async () => {
    const sub = seedSub(testApp);
    const baseTime = Date.now();
    // Insert 3 rows with the SAME createdAt to force the id-tiebreaker path
    testApp.db
      .insert(forwardLog)
      .values([
        {
          subscriptionId: sub.id,
          sourceMessageId: '1',
          status: 'sent',
          createdAt: new Date(baseTime),
          destMessageId: '101',
        },
        {
          subscriptionId: sub.id,
          sourceMessageId: '2',
          status: 'sent',
          createdAt: new Date(baseTime),
          destMessageId: '102',
        },
        {
          subscriptionId: sub.id,
          sourceMessageId: '3',
          status: 'sent',
          createdAt: new Date(baseTime),
          destMessageId: '103',
        },
      ])
      .run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[] };
    expect(body.items.map((i) => i.sourceMessageId)).toEqual(['3', '2', '1']);
  });

  it('paginates with limit + nextOffset', async () => {
    const sub = seedSub(testApp);
    for (let i = 1; i <= 5; i++) {
      testApp.db
        .insert(forwardLog)
        .values({
          subscriptionId: sub.id,
          sourceMessageId: String(i),
          status: 'sent',
          destMessageId: String(100 + i),
        })
        .run();
    }
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log?limit=2',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[]; nextOffset: number | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextOffset).toBe(2);
  });

  it('returns nextOffset null on last page', async () => {
    const sub = seedSub(testApp);
    for (let i = 1; i <= 3; i++) {
      testApp.db
        .insert(forwardLog)
        .values({
          subscriptionId: sub.id,
          sourceMessageId: String(i),
          status: 'sent',
        })
        .run();
    }
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log?limit=2&offset=2',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[]; nextOffset: number | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextOffset).toBeNull();
  });

  it('includes subscriptionTitle, sourceHandle, and destinationName from JOINs', async () => {
    const destinationId = seedDestination(testApp.db, { name: 'My Dest' });
    const sub = seedSub(testApp, {
      title: 'Cool Channel',
      handle: '@cool',
      destinationId,
    });
    testApp.db
      .insert(forwardLog)
      .values({ subscriptionId: sub.id, sourceMessageId: '1', status: 'sent' })
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[] };
    expect(body.items[0]!.subscriptionTitle).toBe('Cool Channel');
    expect(body.items[0]!.sourceHandle).toBe('@cool');
    expect(body.items[0]!.destinationName).toBe('My Dest');
  });

  it('returns null subscription/source/destination fields for orphan rows (deleted sub)', async () => {
    // Insert with NULL subscriptionId directly — simulates ON DELETE SET NULL aftermath
    testApp.db
      .insert(forwardLog)
      .values({
        subscriptionId: null,
        sourceMessageId: '99',
        status: 'failed',
        error: 'sub deleted',
      })
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[] };
    expect(body.items[0]!.subscriptionId).toBeNull();
    expect(body.items[0]!.subscriptionTitle).toBeNull();
    expect(body.items[0]!.sourceHandle).toBeNull();
    expect(body.items[0]!.destinationName).toBeNull();
    expect(body.items[0]!.status).toBe('failed');
  });

  it('returns destinationName null but keeps sub fields when subscription is detached from destination', async () => {
    const sub = seedSub(testApp, {
      title: 'Detached',
      handle: '@detached',
      destinationId: null,
    });
    testApp.db
      .insert(forwardLog)
      .values({ subscriptionId: sub.id, sourceMessageId: '1', status: 'sent' })
      .run();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log',
      headers: { cookie },
    });
    const body = res.json() as { items: ForwardLogEntryDtoLike[] };
    expect(body.items[0]!.subscriptionTitle).toBe('Detached');
    expect(body.items[0]!.sourceHandle).toBe('@detached');
    expect(body.items[0]!.destinationName).toBeNull();
  });

  it('returns 400 when limit exceeds 200', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/forward-log?limit=201',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without cookie', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/forward-log' });
    expect(res.statusCode).toBe(401);
  });
});
