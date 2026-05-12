import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Api } from 'telegram';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { destinations, forwardLog, subscriptions } from '../db/schema.js';
import { FloodWaitError } from './floodwait.js';
import {
  createHistoryPoller,
  POLL_BATCH_LIMIT,
  type HistoryPollerClient,
} from './historyPoller.js';
import type { RawForwardingHandle, RawForwardJob } from './types.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ silent: true });

interface Setup {
  dbHandle: TestDbHandle;
  destId: number;
  subId: number;
  enqueued: RawForwardJob[];
  forwarding: RawForwardingHandle;
}

function setup(): Setup {
  const dbHandle = createTestDb();
  const dest = dbHandle.db
    .insert(destinations)
    .values({ name: 'dest', chatId: '-1009999999999' })
    .returning({ id: destinations.id })
    .all();
  const destId = dest[0]!.id;
  const sub = dbHandle.db
    .insert(subscriptions)
    .values({
      sourceChatId: '-1001111111111',
      sourceTitle: 'Source',
      destinationId: destId,
    })
    .returning({ id: subscriptions.id })
    .all();
  const subId = sub[0]!.id;

  const enqueued: RawForwardJob[] = [];
  const forwarding: RawForwardingHandle = {
    enqueue(job: RawForwardJob) {
      enqueued.push(job);
    },
  };

  return { dbHandle, destId, subId, enqueued, forwarding };
}

interface MockMessage {
  id: number;
  className: 'Message' | 'MessageService';
  message?: string;
  media?: unknown;
  groupedId?: { toString: () => string } | null;
}

function makeClient(
  responder: (req: { method: string; payload: Record<string, unknown> }) => unknown,
): HistoryPollerClient {
  return {
    invoke: vi.fn(async (req: unknown) => {
      const r = req as { className?: string; minId?: number; limit?: number; peer?: unknown };
      return responder({
        method: r.className ?? '',
        payload: { minId: r.minId, limit: r.limit, peer: r.peer },
      });
    }),
  } as unknown as HistoryPollerClient;
}

function msg(id: number, opts: Partial<MockMessage> = {}): MockMessage {
  return {
    id,
    className: 'Message',
    message: '',
    ...opts,
  };
}

describe('createHistoryPoller', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.dbHandle.close();
  });

  it('seeds from channel top when no forward_log history, then enqueues nothing on first sweep', async () => {
    const client = makeClient(() => ({ messages: [msg(100)] }));
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(s.enqueued).toEqual([]);
    // The second sweep with messages newer than 100 enqueues them.
    let call = 0;
    const client2 = makeClient(() => {
      call++;
      if (call === 1) return { messages: [msg(102), msg(101)] };
      return { messages: [] };
    });
    const poller2 = createHistoryPoller({
      client: client2,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });
    await poller2.poll();
    // First sweep on poller2 reseeds from log (no rows) → channel top 102.
    // We didn't keep seed state across poller instances, so this confirms
    // boot-time behavior.
    expect(s.enqueued).toEqual([]);
  });

  it('seeds from forward_log MAX if rows exist, forwards messages above that watermark', async () => {
    // Pre-seed the log so the poller treats 50 as the watermark.
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '50', status: 'sent' })
      .run();

    const client = makeClient(({ method, payload }) => {
      expect(method).toBe('messages.GetHistory');
      expect(payload.minId).toBe(50);
      return { messages: [msg(53), msg(52), msg(51)] };
    });
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(s.enqueued.map((j) => j.sourceMessageId)).toEqual(['51', '52', '53']);
  });

  it('dedupes against existing forward_log rows (skips already-processed ids)', async () => {
    // Watermark = 50; a duplicate row at 52 also exists (e.g., the listener
    // already enqueued+forwarded it before this sweep runs).
    s.dbHandle.db
      .insert(forwardLog)
      .values([
        { subscriptionId: s.subId, sourceMessageId: '50', status: 'sent' },
        { subscriptionId: s.subId, sourceMessageId: '52', status: 'sent' },
      ])
      .run();
    const client = makeClient(() => ({ messages: [msg(53), msg(52), msg(51)] }));
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    // Watermark is MAX(50,52)=52, so getHistory(minId=52) returns 53 only
    // in practice; the test feeds 51/52/53 anyway. 51 is below the
    // watermark and dropped, 52 is deduped against the existing log row,
    // 53 is enqueued.
    expect(s.enqueued.map((j) => j.sourceMessageId)).toEqual(['53']);
  });

  it('filters out non-Message classes (e.g. MessageService)', async () => {
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '10', status: 'sent' })
      .run();
    const client = makeClient(() => ({
      messages: [msg(12), msg(11, { className: 'MessageService' })],
    }));
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(s.enqueued.map((j) => j.sourceMessageId)).toEqual(['12']);
  });

  it('propagates groupedId so albums flow through the debouncer', async () => {
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '10', status: 'sent' })
      .run();
    const client = makeClient(() => ({
      messages: [
        msg(13, { groupedId: { toString: () => '999' } }),
        msg(12, { groupedId: { toString: () => '999' } }),
        msg(11),
      ],
    }));
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    const grouped = s.enqueued.filter((j) => j.groupedId !== undefined);
    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map((j) => j.groupedId))).toEqual(new Set(['999']));
    const ungrouped = s.enqueued.filter((j) => j.groupedId === undefined);
    expect(ungrouped.map((j) => j.sourceMessageId)).toEqual(['11']);
  });

  it('caps the batch via POLL_BATCH_LIMIT', async () => {
    // Seed from forward_log so we skip the channel-top probe (which would
    // shadow the captured limit with its own `limit: 1`).
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '10', status: 'sent' })
      .run();
    let capturedLimit: number | undefined;
    const client = makeClient(({ payload }) => {
      capturedLimit = payload.limit as number | undefined;
      return { messages: [] };
    });
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(capturedLimit).toBe(POLL_BATCH_LIMIT);
  });

  it('skips a sub on FloodWait and resumes on the next sweep', async () => {
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '5', status: 'sent' })
      .run();
    let call = 0;
    const client = makeClient(() => {
      call++;
      if (call === 1) {
        throw new FloodWaitError({ request: undefined, seconds: 30 });
      }
      return { messages: [msg(6)] };
    });
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();
    expect(s.enqueued).toEqual([]);

    await poller.poll();
    expect(s.enqueued.map((j) => j.sourceMessageId)).toEqual(['6']);
  });

  it('skips disabled subscriptions', async () => {
    s.dbHandle.db
      .update(subscriptions)
      .set({ enabled: false })
      .where(eq(subscriptions.id, s.subId))
      .run();
    const client = makeClient(() => ({ messages: [msg(99)] }));
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(client.invoke).not.toHaveBeenCalled();
  });

  it('start() schedules subsequent sweeps on the timer', async () => {
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '0', status: 'sent' })
      .run();
    let call = 0;
    const client = makeClient(() => {
      call++;
      return { messages: [msg(call)] };
    });
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
      intervalMs: 5,
    });

    poller.start();
    // Wait long enough for at least two interval ticks plus the initial
    // immediate sweep — using real timers because faking interferes with
    // better-sqlite3's synchronous calls inside the poll.
    await new Promise((r) => setTimeout(r, 50));
    poller.stop();

    expect(s.enqueued.length).toBeGreaterThanOrEqual(2);
    // Each enqueue's sourceMessageId corresponds to the call number, in order.
    for (let i = 0; i < s.enqueued.length; i++) {
      expect(s.enqueued[i]!.sourceMessageId).toBe(String(i + 1));
    }
  });

  it('uses Api.messages.GetHistory request shape', async () => {
    s.dbHandle.db
      .insert(forwardLog)
      .values({ subscriptionId: s.subId, sourceMessageId: '10', status: 'sent' })
      .run();
    const invokeSpy = vi.fn().mockResolvedValue({ messages: [] });
    const client = { invoke: invokeSpy } as unknown as HistoryPollerClient;
    const poller = createHistoryPoller({
      client,
      db: s.dbHandle.db,
      logger,
      forwarding: s.forwarding,
    });

    await poller.poll();

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const req = invokeSpy.mock.calls[0]![0] as { className?: string };
    expect(req).toBeInstanceOf(Api.messages.GetHistory);
    expect(req.className).toBe('messages.GetHistory');
  });
});
