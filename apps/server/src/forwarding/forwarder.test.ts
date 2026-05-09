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

function makeJob(sub: Subscription, sourceMessageId = '42'): ForwardJob {
  return {
    subscriptionId: sub.id,
    sourceChatId: sub.sourceChatId,
    destinationChatId: sub.destinationChatId,
    sourceMessageId,
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

    const outcome = await forwarder(makeJob(sub, '42'));

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
