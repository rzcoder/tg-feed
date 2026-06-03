/**
 * listener.ts wires gramjs's `addEventHandler` to a closure that touches
 * the DB and forwarding queue. The unit-tested invariants here:
 *
 *   1. The handler errors are caught and logged — a single bad event must
 *      not bubble into gramjs and shake the session.
 *   2. The active-subscriptions query is filtered by `source_chat_id` so
 *      irrelevant rows never get loaded.
 *
 * gramjs's `TelegramClient` is faked with a stub that captures the
 * registered handler for direct invocation; we never start a real client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramClient } from 'telegram';
import type { NewMessageEvent } from 'telegram/events/index.js';
import { destinations, subscriptions } from '../db/schema.js';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import type { RawForwardingHandle, RawForwardJob } from '../forwarding/types.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { attachNewMessageListener } from './listener.js';

interface CapturedHandler {
  handler: (event: NewMessageEvent) => Promise<void>;
}

function fakeClient(captured: CapturedHandler): TelegramClient {
  return {
    addEventHandler: (handler: (event: NewMessageEvent) => Promise<void>) => {
      captured.handler = handler;
    },
  } as unknown as TelegramClient;
}

function makeEvent(chatId: string, messageId: number): NewMessageEvent {
  return {
    message: {
      className: 'Message',
      chatId: { toString: () => chatId },
      id: messageId,
      message: 'hello',
      media: null,
      groupedId: null,
      sender: null,
    },
  } as unknown as NewMessageEvent;
}

describe('attachNewMessageListener', () => {
  let dbHandle: TestDbHandle;
  let logger: Logger;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dbHandle = createTestDb();
    logger = createLogger({ silent: true });
    errorSpy = vi.spyOn(logger, 'error');

    const [dest] = dbHandle.db
      .insert(destinations)
      .values({ name: 'd', chatId: '-100999' })
      .returning()
      .all();
    dbHandle.db
      .insert(subscriptions)
      .values({ sourceChatId: '-100123', sourceTitle: 's', destinationId: dest!.id })
      .run();
  });

  afterEach(() => {
    dbHandle.close();
    errorSpy.mockRestore();
  });

  it('catches and logs errors from the forwarding queue without rethrowing', async () => {
    const captured: Partial<CapturedHandler> = {};
    const forwarding: RawForwardingHandle = {
      enqueue: () => {
        throw new Error('queue exploded');
      },
    };
    attachNewMessageListener(
      fakeClient(captured as CapturedHandler),
      dbHandle.db,
      logger,
      forwarding,
    );
    // The wrapped handler must resolve, NOT reject — that's the whole point
    // of the safe wrapper.
    await expect(captured.handler!(makeEvent('-100123', 1))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({ err: expect.any(Error) });
  });

  it('skips events from chats that have no subscription (WHERE filter excludes them)', async () => {
    const captured: Partial<CapturedHandler> = {};
    const enqueued: RawForwardJob[] = [];
    const forwarding: RawForwardingHandle = {
      enqueue: (job) => {
        enqueued.push(job);
      },
    };
    attachNewMessageListener(
      fakeClient(captured as CapturedHandler),
      dbHandle.db,
      logger,
      forwarding,
    );
    await captured.handler!(makeEvent('-100999999', 7)); // no matching sub
    expect(enqueued).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('enqueues a forward job when the source matches a subscription', async () => {
    const captured: Partial<CapturedHandler> = {};
    const enqueued: RawForwardJob[] = [];
    const forwarding: RawForwardingHandle = {
      enqueue: (job) => {
        enqueued.push(job);
      },
    };
    attachNewMessageListener(
      fakeClient(captured as CapturedHandler),
      dbHandle.db,
      logger,
      forwarding,
    );
    await captured.handler!(makeEvent('-100123', 42));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      sourceChatId: '-100123',
      destinationChatId: '-100999',
      sourceMessageId: '42',
    });
  });

  it('fans out to every subscription that shares the same source', async () => {
    const [dest2] = dbHandle.db
      .insert(destinations)
      .values({ name: 'd2', chatId: '-100888' })
      .returning()
      .all();
    dbHandle.db
      .insert(subscriptions)
      .values({ sourceChatId: '-100123', sourceTitle: 's2', destinationId: dest2!.id })
      .run();

    const captured: Partial<CapturedHandler> = {};
    const enqueued: RawForwardJob[] = [];
    const forwarding: RawForwardingHandle = {
      enqueue: (job) => {
        enqueued.push(job);
      },
    };
    attachNewMessageListener(
      fakeClient(captured as CapturedHandler),
      dbHandle.db,
      logger,
      forwarding,
    );
    await captured.handler!(makeEvent('-100123', 42));
    expect(enqueued).toHaveLength(2);
    expect(enqueued.map((j) => j.destinationChatId).sort()).toEqual(['-100888', '-100999']);
    expect(enqueued.every((j) => j.sourceMessageId === '42')).toBe(true);
  });
});
