// Lists a forum's topics for the destination picker. Never throws — any error degrades to empty,
// so a non-forum chat or gramjs failure can't block saving a destination.
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { ForumTopic } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';

export interface ForumTopicsResult {
  isForum: boolean;
  topics: ForumTopic[];
}

export type ForumTopicLister = (chatId: string) => Promise<ForumTopicsResult>;

// Subset of `TelegramClient` so tests can pass a stub.
export interface ForumTopicListerClient {
  invoke: TelegramClient['invoke'];
}

// Telegram caps `GetForumTopics` at 100 per page; one page is plenty.
const TOPICS_LIMIT = 100;

export function createForumTopicLister(
  client: ForumTopicListerClient,
  logger: Logger,
): ForumTopicLister {
  return async (chatId) => {
    let result: { topics?: unknown[] };
    try {
      result = (await client.invoke(
        new Api.channels.GetForumTopics({ channel: chatId, limit: TOPICS_LIMIT }),
      )) as { topics?: unknown[] };
    } catch (err) {
      // `CHANNEL_FORUM_MISSING` (not a forum) is the expected case here.
      logger.debug({ err, chatId }, 'forum topics: GetForumTopics failed');
      return { isForum: false, topics: [] };
    }

    const topics: ForumTopic[] = [];
    for (const raw of result.topics ?? []) {
      const t = raw as { className?: string; id?: unknown; title?: unknown };
      if (t.className !== 'ForumTopic') continue; // drop ForumTopicDeleted
      if (t.id === undefined || t.id === null || typeof t.title !== 'string') continue;
      topics.push({ id: String(t.id), title: t.title });
    }
    return { isForum: true, topics };
  };
}
