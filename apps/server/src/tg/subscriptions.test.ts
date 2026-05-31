import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { destinations, subscriptions } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import { resolveSubscriptionsOnStartup, type TelegramEntityClient } from './subscriptions.js';

describe('resolveSubscriptionsOnStartup', () => {
  let handle: TestDbHandle;
  const logger = createLogger({ silent: true });
  let destId: number;

  beforeEach(() => {
    handle = createTestDb();
    const inserted = handle.db
      .insert(destinations)
      .values({ name: 'dest', chatId: '-100DEST' })
      .returning({ id: destinations.id })
      .all();
    destId = inserted[0]!.id;
  });

  afterEach(() => {
    handle.close();
  });

  it('resolves both sources and the shared destination, deduped', async () => {
    handle.db
      .insert(subscriptions)
      .values([
        { sourceChatId: '-100A', sourceTitle: 'a', destinationId: destId, enabled: true },
        { sourceChatId: '-100B', sourceTitle: 'b', destinationId: destId, enabled: false },
        { sourceChatId: '-100C', sourceTitle: 'c', destinationId: destId, enabled: true },
      ])
      .run();

    const getEntity = vi.fn().mockResolvedValue({ id: 0 });
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: vi.fn().mockResolvedValue([]) as TelegramEntityClient['getDialogs'],
    };

    await resolveSubscriptionsOnStartup(client, handle.db, logger);

    // Two enabled sources + one shared destination = 3 unique resolves.
    expect(getEntity).toHaveBeenCalledTimes(3);
    expect(getEntity).toHaveBeenCalledWith('-100A');
    expect(getEntity).toHaveBeenCalledWith('-100C');
    expect(getEntity).toHaveBeenCalledWith('-100DEST');
    // Disabled subscription's source must not be resolved.
    expect(getEntity).not.toHaveBeenCalledWith('-100B');
  });

  it('does not throw when getEntity rejects — logs a warning instead', async () => {
    handle.db
      .insert(subscriptions)
      .values({ sourceChatId: '-100X', sourceTitle: 'x', destinationId: destId, enabled: true })
      .run();

    const getEntity = vi.fn().mockRejectedValue(new Error('not found'));
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: vi.fn().mockResolvedValue([]) as TelegramEntityClient['getDialogs'],
    };

    await expect(resolveSubscriptionsOnStartup(client, handle.db, logger)).resolves.toBeUndefined();
    // Both source and destination attempted even though source rejected.
    expect(getEntity).toHaveBeenCalledTimes(2);
  });

  it('is a no-op for getEntity with no enabled subscriptions (still primes via getDialogs)', async () => {
    const getEntity = vi.fn();
    const getDialogs = vi.fn().mockResolvedValue([]);
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: getDialogs as TelegramEntityClient['getDialogs'],
    };
    await resolveSubscriptionsOnStartup(client, handle.db, logger);
    expect(getEntity).not.toHaveBeenCalled();
    expect(getDialogs).toHaveBeenCalledTimes(1);
  });

  it('still resolves subscriptions when the getDialogs prime fails', async () => {
    handle.db
      .insert(subscriptions)
      .values({ sourceChatId: '-100A', sourceTitle: 'a', destinationId: destId, enabled: true })
      .run();

    const getEntity = vi.fn().mockResolvedValue({ id: 0 });
    const getDialogs = vi.fn().mockRejectedValue(new Error('FLOOD_WAIT 5'));
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: getDialogs as TelegramEntityClient['getDialogs'],
    };

    await expect(resolveSubscriptionsOnStartup(client, handle.db, logger)).resolves.toBeUndefined();
    expect(getDialogs).toHaveBeenCalledTimes(1);
    expect(getEntity).toHaveBeenCalledTimes(2);
  });

  it('resolves chats sequentially (no Promise.all) to avoid boot-time flood waits', async () => {
    handle.db
      .insert(subscriptions)
      .values([
        { sourceChatId: '-100A', sourceTitle: 'a', destinationId: destId, enabled: true },
        { sourceChatId: '-100B', sourceTitle: 'b', destinationId: destId, enabled: true },
      ])
      .run();

    let inflight = 0;
    let maxInflight = 0;
    const getEntity = vi.fn().mockImplementation(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await Promise.resolve();
      inflight--;
      return { id: 0 };
    });
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: vi.fn().mockResolvedValue([]) as TelegramEntityClient['getDialogs'],
    };

    await resolveSubscriptionsOnStartup(client, handle.db, logger);
    expect(maxInflight).toBe(1);
  });

  it('dedupes when two subscriptions share both source and destination', async () => {
    // Two rows with identical chat IDs (e.g. duplicate subscription entries)
    // — the loop must call getEntity per unique chat, not per row.
    handle.db
      .insert(subscriptions)
      .values([
        { sourceChatId: '-100A', sourceTitle: 'a', destinationId: destId, enabled: true },
        { sourceChatId: '-100A', sourceTitle: 'a-dup', destinationId: destId, enabled: true },
      ])
      .run();

    const getEntity = vi.fn().mockResolvedValue({ id: 0 });
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
      getDialogs: vi.fn().mockResolvedValue([]) as TelegramEntityClient['getDialogs'],
    };

    await resolveSubscriptionsOnStartup(client, handle.db, logger);
    expect(getEntity).toHaveBeenCalledTimes(2);
    expect(getEntity).toHaveBeenCalledWith('-100A');
    expect(getEntity).toHaveBeenCalledWith('-100DEST');
  });
});
