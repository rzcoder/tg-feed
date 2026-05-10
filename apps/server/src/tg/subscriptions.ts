import { eq } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import type { Db } from '../db/client.js';
import { subscriptions } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

// Minimal surface of TelegramClient we depend on, so tests can pass a stub.
export interface TelegramEntityClient {
  getEntity: TelegramClient['getEntity'];
}

export async function resolveSubscriptionsOnStartup(
  client: TelegramEntityClient,
  db: Db,
  logger: Logger,
): Promise<void> {
  const enabled = db.select().from(subscriptions).where(eq(subscriptions.enabled, true)).all();

  await Promise.all(
    enabled.map(async (sub) => {
      try {
        await client.getEntity(sub.sourceChatId);
        logger.debug(
          { subscriptionId: sub.id, sourceChatId: sub.sourceChatId },
          'subscription resolved',
        );
      } catch (err) {
        logger.warn(
          { subscriptionId: sub.id, sourceChatId: sub.sourceChatId, err },
          'failed to resolve subscription on startup',
        );
      }
    }),
  );
}
