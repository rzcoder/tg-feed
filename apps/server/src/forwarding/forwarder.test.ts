import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { forwardLog, subscriptions, type Subscription } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import { createForwarder, type ForwarderClient } from './forwarder.js';
import type { ForwardJob } from './types.js';

const logger = createLogger({ silent: true });

function seedSubscription(handle: TestDbHandle): Subscription {
  const [row] = handle.db
    .insert(subscriptions)
    .values({
      sourceChatId: '-100SOURCE',
      sourceTitle: 'src',
      destinationChatId: '-100DEST',
    })
    .returning()
    .all();
  return row!;
}

function makeJob(sub: Subscription, sourceMessageIds: string[] = ['42']): ForwardJob {
  return {
    subscriptionId: sub.id,
    sourceChatId: sub.sourceChatId,
    destinationChatId: sub.destinationChatId,
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
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
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
  });

  it('forwards an album in one call and writes one log row per source id, paired with dest ids by index', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockResolvedValue([{ id: 901 }, { id: 902 }, { id: 903 }]);
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
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
  });

  it('records flood_wait and returns the seconds when the client throws FloodWaitError', async () => {
    const sub = seedSubscription(handle);
    class FloodWaitError extends Error {
      seconds = 17;
    }
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new FloodWaitError('flood'));
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome).toEqual({ status: 'flood_wait', seconds: 17 });
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.status).toBe('flood_wait');
    expect(row?.destMessageId).toBeNull();
    expect(row?.error).toMatch(/flood_wait 17s/);
  });

  it('records failed and returns the error message on a non-FloodWait error', async () => {
    const sub = seedSubscription(handle);
    const forwardMessages = vi
      .fn<ForwarderClient['forwardMessages']>()
      .mockRejectedValue(new Error('bad request'));
    const forwarder = createForwarder({
      client: { forwardMessages },
      db: handle.db,
      logger,
    });

    const outcome = await forwarder(makeJob(sub));

    expect(outcome).toEqual({ status: 'failed', error: 'bad request' });
    const [row] = handle.db.select().from(forwardLog).all();
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('bad request');
    expect(row?.destMessageId).toBeNull();
  });
});
