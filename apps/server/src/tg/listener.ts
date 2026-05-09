import { eq } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import type { Db } from '../db/client.js';
import { subscriptions } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import { extractMatchableEvent, matchSubscription } from './messageMatcher.js';

export function attachNewMessageListener(client: TelegramClient, db: Db, logger: Logger): void {
  const handler = async (event: NewMessageEvent): Promise<void> => {
    const matchable = extractMatchableEvent(event);
    if (!matchable) return;

    const activeSubs = db.select().from(subscriptions).where(eq(subscriptions.enabled, true)).all();
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
  };

  client.addEventHandler(handler, new NewMessage({}));
}
