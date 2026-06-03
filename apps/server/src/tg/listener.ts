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
  matchSubscriptions,
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

    // WHERE source_chat_id hits idx_subscriptions_source_chat_id, not a full scan.
    const activeSubs = db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        sourceTitle: subscriptions.sourceTitle,
        handle: subscriptions.handle,
        destinationId: subscriptions.destinationId,
        destinationChatId: destinations.chatId,
        destinationTopicId: destinations.topicId,
        enabled: subscriptions.enabled,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .where(and(eq(subscriptions.enabled, true), eq(subscriptions.sourceChatId, matchable.chatId)))
      .all() as ResolvedSubscription[];
    const matched = matchSubscriptions(matchable, activeSubs);

    if (matched.length === 0) {
      logger.debug(
        { chatId: matchable.chatId, messageId: matchable.messageId },
        'message has no matching subscription',
      );
      return;
    }

    // One snapshot of the source message, reused for every fan-out destination.
    const rawMessage = toJsonSafe(event.message);
    for (const sub of matched) {
      logger.info(
        {
          subscriptionId: sub.id,
          sourceChatId: sub.sourceChatId,
          messageId: matchable.messageId,
          hasMedia: !!event.message.media,
        },
        'message matched subscription',
      );

      forwarding.enqueue({
        subscriptionId: sub.id,
        sourceChatId: sub.sourceChatId,
        destinationChatId: sub.destinationChatId,
        destinationTopicId: sub.destinationTopicId,
        sourceMessageId: matchable.messageId,
        text: matchable.text,
        hasMedia: matchable.hasMedia,
        rawMessage,
        ...(matchable.groupedId !== undefined ? { groupedId: matchable.groupedId } : {}),
        ...(matchable.senderUsername !== undefined
          ? { senderUsername: matchable.senderUsername }
          : {}),
      });
    }
  };

  // Drop a single bad event rather than let it bubble into gramjs and destabilise the TG session.
  const safeHandler = async (event: NewMessageEvent): Promise<void> => {
    try {
      await handler(event);
    } catch (err) {
      logger.error(
        { err, errorType: err instanceof Error ? err.constructor.name : typeof err },
        'listener handler threw; dropping event',
      );
    }
  };

  // incoming: true filters out events the userbot itself produced.
  client.addEventHandler(safeHandler, new NewMessage({ incoming: true }));
}
