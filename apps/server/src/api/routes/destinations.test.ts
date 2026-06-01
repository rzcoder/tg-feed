import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DestinationDto } from '@tg-feed/shared';
import { destinations, subscriptions } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import type { ChatResolver } from '../../tg/chatResolver.js';
import type { ImportInviteFn } from '../../tg/inviteResolver.js';
import type { ProfilePhotoFetcher } from '../../tg/profilePhoto.js';
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
      iconDataUrl: null,
    });
    expect(typeof body.createdAt).toBe('string');
  });

  it('POST /api/destinations persists and returns a forum topic', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'forum', chatId: '-1009374102931', topicId: '42', topicTitle: 'Releases' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as DestinationDto;
    expect(body.topicId).toBe('42');
    expect(body.topicTitle).toBe('Releases');
    const [row] = testApp.db.select().from(destinations).all();
    expect(row).toMatchObject({ topicId: '42', topicTitle: 'Releases' });
  });

  it('PATCH /api/destinations/:id re-targets and clears the topic', async () => {
    const [d] = testApp.db
      .insert(destinations)
      .values({ name: 'forum', chatId: '-1001111111111', topicId: '42', topicTitle: 'Releases' })
      .returning({ id: destinations.id })
      .all();

    const retarget = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
      payload: { topicId: '7', topicTitle: 'Random' },
    });
    expect((retarget.json() as DestinationDto).topicId).toBe('7');
    expect((retarget.json() as DestinationDto).topicTitle).toBe('Random');

    const clear = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/destinations/${d!.id}`,
      headers: { cookie },
      payload: { topicId: null, topicTitle: null },
    });
    expect((clear.json() as DestinationDto).topicId).toBeNull();
    expect((clear.json() as DestinationDto).topicTitle).toBeNull();
  });

  it('POST /api/destinations/topics returns the lister result', async () => {
    const listForumTopics = vi.fn().mockResolvedValue({
      isForum: true,
      topics: [{ id: '42', title: 'Releases' }],
    });
    const app = await buildTestApp({ listForumTopics });
    const c = await app.loginAndGetCookie();
    const res = await app.app.inject({
      method: 'POST',
      url: '/api/destinations/topics',
      headers: { cookie: c },
      payload: { chatId: '-1001234567890' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isForum: true, topics: [{ id: '42', title: 'Releases' }] });
    expect(listForumTopics).toHaveBeenCalledWith('-1001234567890');
    await app.close();
  });

  it('POST /api/destinations/topics returns 503 when Telegram is unavailable', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations/topics',
      headers: { cookie },
      payload: { chatId: '-1001234567890' },
    });
    expect(res.statusCode).toBe(503);
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

describe('POST /api/destinations/resolve', () => {
  it('returns 503 telegram_unavailable when no resolver configured', async () => {
    const testApp = await buildTestApp();
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations/resolve',
      headers: { cookie },
      payload: { input: 'foo' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'telegram_unavailable' } });
    await testApp.close();
  });

  it('returns the resolver response for a public handle', async () => {
    const resolver = vi.fn<ChatResolver>().mockResolvedValue({
      chatId: '-1001234567890',
      title: 'Anthropic',
      handle: '@anthropic_ai',
      inviteHash: null,
      alreadyMember: true,
      isForum: false,
    });
    const testApp = await buildTestApp({ chatResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations/resolve',
      headers: { cookie },
      payload: { input: '@anthropic_ai' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      chatId: '-1001234567890',
      title: 'Anthropic',
      handle: '@anthropic_ai',
      inviteHash: null,
      alreadyMember: true,
      isForum: false,
    });
    await testApp.close();
  });

  it('returns null chatId + the invite hash for a not-yet-joined invite', async () => {
    const resolver = vi.fn<ChatResolver>().mockResolvedValue({
      chatId: null,
      title: 'Secret',
      handle: null,
      inviteHash: 'LtdmkRfh24oxZjYy',
      alreadyMember: false,
      isForum: false,
    });
    const testApp = await buildTestApp({ chatResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations/resolve',
      headers: { cookie },
      payload: { input: 'https://t.me/+LtdmkRfh24oxZjYy' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { chatId: string | null; inviteHash: string | null };
    expect(body.chatId).toBeNull();
    expect(body.inviteHash).toBe('LtdmkRfh24oxZjYy');
    await testApp.close();
  });

  it('maps NotFoundError → 404', async () => {
    const resolver = vi.fn<ChatResolver>().mockRejectedValue(new NotFoundError('invite link'));
    const testApp = await buildTestApp({ chatResolver: resolver });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations/resolve',
      headers: { cookie },
      payload: { input: '+expired' },
    });
    expect(res.statusCode).toBe(404);
    await testApp.close();
  });
});

describe('POST /api/destinations with inviteHash', () => {
  it('joins via importInvite and inserts using the returned chatId', async () => {
    const importInvite = vi.fn<ImportInviteFn>().mockResolvedValue({
      status: 'ok',
      chatId: '-1001234567890',
      title: 'Joined',
    });
    const testApp = await buildTestApp({ importInvite });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', inviteHash: 'LtdmkRfh24oxZjYy', note: 'private' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as DestinationDto;
    expect(body.chatId).toBe('-1001234567890');
    expect(body.accessStatus).toBe('ok');
    expect(body.accessCheckedAt).not.toBeNull();
    expect(importInvite).toHaveBeenCalledWith('LtdmkRfh24oxZjYy');
    await testApp.close();
  });

  it('returns 503 invite_join_failed when importInvite reports no_access', async () => {
    const importInvite = vi.fn<ImportInviteFn>().mockResolvedValue({
      status: 'no_access',
      chatId: null,
      title: null,
    });
    const testApp = await buildTestApp({ importInvite });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', inviteHash: 'LtdmkRfh24oxZjYy' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'invite_join_failed' } });
    expect(testApp.db.select().from(destinations).all()).toHaveLength(0);
    await testApp.close();
  });

  it('returns 503 telegram_unavailable when inviteHash arrives with no importInvite configured', async () => {
    const testApp = await buildTestApp();
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', inviteHash: 'LtdmkRfh24oxZjYy' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'telegram_unavailable' } });
    await testApp.close();
  });

  it('rejects body with both chatId and inviteHash', async () => {
    const testApp = await buildTestApp();
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: {
        name: 'ops',
        chatId: '-1001234567890',
        inviteHash: 'LtdmkRfh24oxZjYy',
      },
    });
    expect(res.statusCode).toBe(400);
    await testApp.close();
  });

  it('rejects body with neither chatId nor inviteHash', async () => {
    const testApp = await buildTestApp();
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops' },
    });
    expect(res.statusCode).toBe(400);
    await testApp.close();
  });
});

describe('POST /api/destinations icon stamping', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ==';

  it('stamps the iconDataUrl returned by fetchProfilePhoto', async () => {
    const fetchProfilePhoto = vi.fn<ProfilePhotoFetcher>().mockResolvedValue(dataUrl);
    const testApp = await buildTestApp({ fetchProfilePhoto });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', chatId: '-1009374102931' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as DestinationDto).iconDataUrl).toBe(dataUrl);
    expect(fetchProfilePhoto).toHaveBeenCalledWith('-1009374102931');
    await testApp.close();
  });

  it('leaves iconDataUrl null when fetchProfilePhoto returns null (no photo / failure)', async () => {
    const fetchProfilePhoto = vi.fn<ProfilePhotoFetcher>().mockResolvedValue(null);
    const testApp = await buildTestApp({ fetchProfilePhoto });
    const cookie = await testApp.loginAndGetCookie();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/destinations',
      headers: { cookie },
      payload: { name: 'ops', chatId: '-1009374102931' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as DestinationDto).iconDataUrl).toBeNull();
    await testApp.close();
  });
});
