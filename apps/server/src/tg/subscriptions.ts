import { eq } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import type { Db } from '../db/client.js';
import { destinations, subscriptions } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

// Minimal surface of TelegramClient we depend on, so tests can pass a stub.
// `getDialogs` is included so the cache-prime step can hit the same path
// `getEntity` does, just for every dialog at once.
export interface TelegramEntityClient {
  getEntity: TelegramClient['getEntity'];
  getDialogs: TelegramClient['getDialogs'];
}

/**
 * Warm gramjs's per-session entity cache for every chat we'll talk to.
 *
 * Both source and destination chats need a valid `access_hash` in the cache
 * before `forwardMessages` will accept them as `InputPeer`. A fresh
 * `StringSession` (or one rebuilt after a long disconnect) doesn't carry
 * those — the first reference to an unseen chat would fail with
 * `PEER_ID_INVALID`/`CHANNEL_INVALID` until something else (a manual
 * `getEntity`, `getDialogs`, etc.) populates the cache.
 *
 * We make a single `getDialogs` call up front so every chat the userbot is
 * already a member of lands in the cache in one round-trip. The per-target
 * `getEntity` loop afterwards then almost always hits the cache, and the
 * tail of channels we're a member of but haven't dialoged with recently
 * still fall back to the real RPC — but at least the common case (every
 * subscribed source + destination) is primed.
 *
 * Resolves are sequential rather than `Promise.all` because parallel
 * `resolveUsername`/`getFullChannel` calls scale linearly with the number
 * of subscriptions and can easily trip Telegram's per-method rate limit on
 * boot. Boot is fine to take a few extra seconds; a flood-wait isn't.
 */
export async function resolveSubscriptionsOnStartup(
  client: TelegramEntityClient,
  db: Db,
  logger: Logger,
): Promise<void> {
  // Prime the entity cache. A failure here just means the per-target loop
  // below will pay the per-call resolve cost (and may fail loudly if the
  // chat genuinely isn't in cache); it's never fatal.
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

  // Dedupe — multiple subscriptions can share a destination, and a single
  // chat could in principle appear as both source and destination. Each
  // chat only needs to be warmed once per boot.
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
