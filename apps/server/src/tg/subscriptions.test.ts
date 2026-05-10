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

  it('calls getEntity for every enabled subscription and skips disabled ones', async () => {
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
    };

    await resolveSubscriptionsOnStartup(client, handle.db, logger);

    expect(getEntity).toHaveBeenCalledTimes(2);
    expect(getEntity).toHaveBeenCalledWith('-100A');
    expect(getEntity).toHaveBeenCalledWith('-100C');
  });

  it('does not throw when getEntity rejects — logs a warning instead', async () => {
    handle.db
      .insert(subscriptions)
      .values({ sourceChatId: '-100X', sourceTitle: 'x', destinationId: destId, enabled: true })
      .run();

    const getEntity = vi.fn().mockRejectedValue(new Error('not found'));
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
    };

    await expect(resolveSubscriptionsOnStartup(client, handle.db, logger)).resolves.toBeUndefined();
    expect(getEntity).toHaveBeenCalledOnce();
  });

  it('is a no-op with an empty subscription table', async () => {
    const getEntity = vi.fn();
    const client: TelegramEntityClient = {
      getEntity: getEntity as TelegramEntityClient['getEntity'],
    };
    await resolveSubscriptionsOnStartup(client, handle.db, logger);
    expect(getEntity).not.toHaveBeenCalled();
  });
});
