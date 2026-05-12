import { eq, and } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import type { Db } from '../db/client.js';
import { destinations, subscriptions } from '../db/schema.js';
import type { RawForwardingHandle } from '../forwarding/types.js';
import { toJsonSafe } from '../lib/jsonSafe.js';
import type { Logger } from '../lib/logger.js';
import {
  extractMatchableEvent,
  matchSubscription,
  type ResolvedSubscription,
} from './messageMatcher.js';

export function attachNewMessageListener(
  client: TelegramClient,
  db: Db,
  logger: Logger,
  forwarding: RawForwardingHandle,
): void {
  const handler = async (event: NewMessageEvent): Promise<void> => {
    const matchable = extractMatchableEvent(event);
    if (!matchable) return;

    // Filter by source_chat_id in the WHERE clause (backed by
    // idx_subscriptions_source_chat_id) so the DB returns only the rows
    // that could possibly match — usually 0 or 1, never the full table.
    const activeSubs = db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        sourceTitle: subscriptions.sourceTitle,
        handle: subscriptions.handle,
        destinationId: subscriptions.destinationId,
        destinationChatId: destinations.chatId,
        enabled: subscriptions.enabled,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .where(and(eq(subscriptions.enabled, true), eq(subscriptions.sourceChatId, matchable.chatId)))
      .all() as ResolvedSubscription[];
    const matched = matchSubscription(matchable, activeSubs);

    if (!matched) {
      logger.debug(
        { chatId: matchable.chatId, messageId: matchable.messageId },
        'message has no matching subscription',
      );
      return;
    }

    logger.info(
      {
        subscriptionId: matched.id,
        sourceChatId: matched.sourceChatId,
        messageId: matchable.messageId,
        hasMedia: !!event.message.media,
      },
      'message matched subscription',
    );

    forwarding.enqueue({
      subscriptionId: matched.id,
      sourceChatId: matched.sourceChatId,
      destinationChatId: matched.destinationChatId,
      sourceMessageId: matchable.messageId,
      text: matchable.text,
      hasMedia: matchable.hasMedia,
      rawMessage: toJsonSafe(event.message),
      ...(matchable.groupedId !== undefined ? { groupedId: matchable.groupedId } : {}),
      ...(matchable.senderUsername !== undefined
        ? { senderUsername: matchable.senderUsername }
        : {}),
    });
  };

  // Wrap the handler so a single bad event (DB hiccup, malformed gramjs
  // payload, downstream throw from `enqueue`) gets logged and dropped
  // instead of bubbling up into gramjs and potentially destabilising the
  // whole TG session.
  const safeHandler = async (event: NewMessageEvent): Promise<void> => {
    try {
      await handler(event);
    } catch (err) {
      logger.error({ err }, 'listener handler threw; dropping event');
    }
  };

  // `incoming: true` filters out events the userbot itself produced. Without
  // this, if a destination chat ever overlaps with a subscribed source the
  // forwarded copy would be re-ingested as a new event and cause a loop.
  // The SQL filter on `sourceChatId` happens to mask most of those today,
  // but excluding self-events at the gramjs layer is cheaper and removes the
  // foot-gun entirely. `outgoing: false` is mutually exclusive with this and
  // would be the equivalent inverse selector — gramjs accepts either form.
  client.addEventHandler(safeHandler, new NewMessage({ incoming: true }));
}
