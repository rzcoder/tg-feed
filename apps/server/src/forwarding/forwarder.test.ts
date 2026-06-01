import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StreamEventInput } from '@tg-feed/shared';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { destinations, forwardLog, subscriptions, type Subscription } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { createLogger } from '../lib/logger.js';
import { createForwarder, type ForwarderClient } from './forwarder.js';
import type { ForwardJob } from './types.js';

const logger = createLogger({ silent: true });

interface StubBus extends EventBus {
  emitted: StreamEventInput[];
}

function makeStubBus(): StubBus {
  const emitted: StreamEventInput[] = [];
  return {
    emitted,
    emit(input) {
      emitted.push(input);
    },
    on() {
      return () => {};
    },
    listenerCount() {
      return 0;
    },
  };
}

function seedSubscription(handle: TestDbHandle): Subscription {
  const [d] = handle.db
    .insert(destinations)
    .values({ name: 'd', chatId: '-100DEST' })
    .returning({ id: destinations.id })
    .all();
  const [row] = handle.db
    .insert(subscriptions)
    .values({
      sourceChatId: '-100SOURCE',
      sourceTitle: 'src',
      destinationId: d!.id,
    })
    .returning()
    .all();
  return row!;
}

function makeJob(sub: Subscription, sourceMessageIds: string[] = ['42']): ForwardJob {
  return {
    subscriptionId: sub.id,
    sourceChatId: sub.sourceChatId,
    destinationChatId: '-100DEST',
    sourceMessageIds,
  };
}

describe('createForwarder', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = createTestDb();
  });

  afterEach(() => {
    handle.close();
  });

  it('forwards via gramjs and records a sent log row', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 999 }]);
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub, ['42']));

    expect(forwardMessages).toHaveBeenCalledWith('-100DEST', {
      messages: [42],
      fromPeer: '-100SOURCE',
    });
    expect(outcome).toEqual({ status: 'sent', destMessageIds: ['999'] });
    const rows = handle.db.select().from(forwardLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subscriptionId: sub.id,
      sourceMessageId: '42',
      destMessageId: '999',
      status: 'sent',
      error: null,
    });
    expect(bus.emitted.map((e) => e.type)).toEqual(['forward.started', 'forward.completed']);
    expect(bus.emitted[1]).toMatchObject({
      type: 'forward.completed',
      subscriptionId: sub.id,
      sourceChatId: '-100SOURCE',
      destinationChatId: '-100DEST',
      sourceMessageIds: ['42'],
      destMessageIds: ['999'],
    });
  });

  it('passes topMsgId when the job targets a forum topic, omits it otherwise', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 999 }]);
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus: makeStubBus(),
    });

    await forwarder({ ...makeJob(sub, ['42']), destinationTopicId: '7' });
    expect(forwardMessages).toHaveBeenLastCalledWith('-100DEST', {
      messages: [42],
      fromPeer: '-100SOURCE',
      topMsgId: 7,
    });

    await forwarder({ ...makeJob(sub, ['43']), destinationTopicId: null });
    expect(forwardMessages).toHaveBeenLastCalledWith('-100DEST', {
      messages: [43],
      fromPeer: '-100SOURCE',
    });
  });

  it('forwards an album in one call and writes one log row per source id, paired with dest ids by index', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 901 }, { id: 902 }, { id: 903 }]);
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub, ['42', '43', '44']));

    expect(forwardMessages).toHaveBeenCalledTimes(1);
    expect(forwardMessages).toHaveBeenCalledWith('-100DEST', {
      messages: [42, 43, 44],
      fromPeer: '-100SOURCE',
    });
    expect(outcome).toEqual({ status: 'sent', destMessageIds: ['901', '902', '903'] });
    const rows = handle.db
      .select()
      .from(forwardLog)
      .all()
      .sort((a, b) => Number(a.sourceMessageId) - Number(b.sourceMessageId));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ sourceMessageId: '42', destMessageId: '901', status: 'sent' });
    expect(rows[1]).toMatchObject({ sourceMessageId: '43', destMessageId: '902', status: 'sent' });
    expect(rows[2]).toMatchObject({ sourceMessageId: '44', destMessageId: '903', status: 'sent' });
    expect(bus.emitted).toHaveLength(2);
    expect(bus.emitted[1]).toMatchObject({
      type: 'forward.completed',
      sourceMessageIds: ['42', '43', '44'],
      destMessageIds: ['901', '902', '903'],
    });
  });

  it('treats entries without a numeric id as missing and logs the rest as sent', async () => {
    // Regression: gramjs's helper occasionally returns Updates entries that
    // aren't full Messages (MessageEmpty, service-message stubs, sparse null
    // slots). Mapping `.id.toString()` over those used to throw and turn a
    // successful forward into a `failed` activity row.
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 901 }, { id: undefined }, null, { id: 903 }] as never);
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub, ['42', '43', '44', '45']));

    expect(outcome).toEqual({ status: 'sent', destMessageIds: ['901', '903'] });
    const rows = handle.db
      .select()
      .from(forwardLog)
      .all()
      .sort((a, b) => Number(a.sourceMessageId) - Number(b.sourceMessageId));
    expect(rows).toHaveLength(4);
    // Source ids pair with the surviving dest ids by index; the tail
    // beyond `destMessageIds.length` carries `destMessageId=null` but
    // still status='sent' so the activity feed reflects the truth.
    expect(rows[0]).toMatchObject({ sourceMessageId: '42', destMessageId: '901', status: 'sent' });
    expect(rows[1]).toMatchObject({ sourceMessageId: '43', destMessageId: '903', status: 'sent' });
    expect(rows[2]).toMatchObject({ sourceMessageId: '44', destMessageId: null, status: 'sent' });
    expect(rows[3]).toMatchObject({ sourceMessageId: '45', destMessageId: null, status: 'sent' });
  });

  it('records flood_wait and returns the seconds when the client throws FloodWaitError', async () => {
    const sub = seedSubscription(handle);
    class FloodWaitError extends Error {
      seconds = 17;
    }
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new FloodWaitError('flood'));
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome).toEqual({ status: 'flood_wait', seconds: 17, kind: 'flood_wait' });
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.status).toBe('flood_wait');
    expect(row?.destMessageId).toBeNull();
    expect(row?.error).toMatch(/flood_wait 17s/);
    expect(bus.emitted.map((e) => e.type)).toEqual(['forward.started', 'forward.flood_wait']);
    expect(bus.emitted[1]).toMatchObject({
      type: 'forward.flood_wait',
      subscriptionId: sub.id,
      sourceMessageIds: ['42'],
      seconds: 17,
    });
  });

  it('records flood_wait with kind=slow_mode when the client throws SlowModeWaitError', async () => {
    const sub = seedSubscription(handle);
    class SlowModeWaitError extends Error {
      seconds = 90;
    }
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new SlowModeWaitError('slowmode'));
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome).toEqual({ status: 'flood_wait', seconds: 90, kind: 'slow_mode' });
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.status).toBe('flood_wait');
    expect(row?.error).toMatch(/slow_mode 90s/);
    expect(bus.emitted.map((e) => e.type)).toEqual(['forward.started', 'forward.flood_wait']);
  });

  it('records failed (transient) and returns the error message on an unknown error', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('bad request'));
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome).toEqual({ status: 'failed', error: 'bad request', failureKind: 'transient' });
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('bad request');
    expect(row?.destMessageId).toBeNull();
    expect(bus.emitted.map((e) => e.type)).toEqual(['forward.started', 'forward.failed']);
    expect(bus.emitted[1]).toMatchObject({
      type: 'forward.failed',
      subscriptionId: sub.id,
      error: 'bad request',
    });
  });

  it('classifies CHAT_FORWARDS_RESTRICTED as a permanent failure with a tagged error message', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('CHAT_FORWARDS_RESTRICTED: forwarding disabled'));
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failureKind).toBe('permanent_chat_forwards_restricted');
    expect(outcome.error).toMatch(/^permanent_chat_forwards_restricted:/);
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.error).toMatch(/^permanent_chat_forwards_restricted:/);
  });

  it('stamps forwardingRestrictedAt on CHAT_FORWARDS_RESTRICTED', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('CHAT_FORWARDS_RESTRICTED'));
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus: makeStubBus(),
    });

    await forwarder(makeJob(sub));

    const updated = handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, sub.id))
      .get();
    expect(updated?.forwardingRestrictedAt).toBeInstanceOf(Date);
  });

  it('clears forwardingRestrictedAt on the next successful forward', async () => {
    const sub = seedSubscription(handle);
    handle.db
      .update(subscriptions)
      .set({ forwardingRestrictedAt: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.id, sub.id))
      .run();

    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 1 }]);
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus: makeStubBus(),
    });

    await forwarder(makeJob(sub));

    const updated = handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, sub.id))
      .get();
    expect(updated?.forwardingRestrictedAt).toBeNull();
  });

  it('does not stamp forwardingRestrictedAt for transient errors', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('network hiccup'));
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus: makeStubBus(),
    });

    await forwarder(makeJob(sub));

    const updated = handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, sub.id))
      .get();
    expect(updated?.forwardingRestrictedAt).toBeNull();
  });

  it('classifies AUTH_KEY_UNREGISTERED as fatal', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('AUTH_KEY_UNREGISTERED'));
    const bus = makeStubBus();
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    const outcome = await forwarder(makeJob(sub));
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failureKind).toBe('fatal_auth_key_unregistered');
  });

  it('emits forward.started before invoking the client', async () => {
    const sub = seedSubscription(handle);
    const bus = makeStubBus();
    const forwardMessages = vi.fn<ForwarderClient['forwardMessages']>().mockImplementation(() => {
      // Capture emit ordering at the moment the client is called.
      expect(bus.emitted.map((e) => e.type)).toEqual(['forward.started']);
      return Promise.resolve([{ id: 1 }]);
    });
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
      bus,
    });

    await forwarder(makeJob(sub, ['7']));
    expect(bus.emitted[0]).toMatchObject({
      type: 'forward.started',
      subscriptionId: sub.id,
      sourceMessageIds: ['7'],
    });
  });
});
