import { eq } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import type { Db } from '../db/client.js';
import { destinations, subscriptions } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

export interface TelegramEntityClient {
  getEntity: TelegramClient['getEntity'];
  getDialogs: TelegramClient['getDialogs'];
}

// Warm gramjs's entity cache (one getDialogs + a getEntity loop) so forwardMessages has the access_hash
// each chat needs as an InputPeer; without it the first reference fails PEER_ID_INVALID/CHANNEL_INVALID.
// Resolves are sequential, not Promise.all, to avoid tripping Telegram's per-method rate limit on boot.
export async function resolveSubscriptionsOnStartup(
  client: TelegramEntityClient,
  db: Db,
  logger: Logger,
): Promise<void> {
  // Never fatal: on failure the per-target loop below just pays the per-call resolve cost.
  try {
    await client.getDialogs({ limit: 200 });
    logger.debug('warmed entity cache via getDialogs');
  } catch (err) {
    logger.warn({ err }, 'getDialogs prime failed; per-chat resolves may fail');
  }

  const rows = db
    .select({
      subscriptionId: subscriptions.id,
      sourceChatId: subscriptions.sourceChatId,
      destinationChatId: destinations.chatId,
    })
    .from(subscriptions)
    .innerJoin(destinations, eq(subscriptions.destinationId, destinations.id))
    .where(eq(subscriptions.enabled, true))
    .all();

  // Dedupe: a chat shared across subscriptions (or as both source and destination) is warmed once.
  const seen = new Set<string>();
  const targets: Array<{ chatId: string; role: 'source' | 'destination'; subscriptionId: number }> =
    [];
  for (const row of rows) {
    if (!seen.has(row.sourceChatId)) {
      seen.add(row.sourceChatId);
      targets.push({
        chatId: row.sourceChatId,
        role: 'source',
        subscriptionId: row.subscriptionId,
      });
    }
    if (!seen.has(row.destinationChatId)) {
      seen.add(row.destinationChatId);
      targets.push({
        chatId: row.destinationChatId,
        role: 'destination',
        subscriptionId: row.subscriptionId,
      });
    }
  }

  for (const target of targets) {
    try {
      await client.getEntity(target.chatId);
      logger.debug(
        { subscriptionId: target.subscriptionId, chatId: target.chatId, role: target.role },
        'chat resolved on startup',
      );
    } catch (err) {
      logger.warn(
        { subscriptionId: target.subscriptionId, chatId: target.chatId, role: target.role, err },
        'failed to resolve chat on startup',
      );
    }
  }
}
