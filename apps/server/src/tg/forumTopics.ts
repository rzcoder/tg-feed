/**
 * Lists a forum supergroup's topics so the destination UI can offer a picker.
 *
 * Backs `POST /api/destinations/topics`. Calls `channels.GetForumTopics` and
 * maps each live `ForumTopic` to `{ id, title }`; `ForumTopicDeleted` entries
 * are dropped. The General topic (reserved `top_msg_id` 1) is returned like
 * any other — the web layer represents "General" as the null/no-topic choice.
 *
 * Never throws: a non-forum chat, a missing channel, or any gramjs error
 * resolves to `{ isForum: false, topics: [] }` so the picker degrades to
 * "no topic" instead of failing the request. The channel is passed as a raw
 * id string — gramjs resolves entity-likes inside raw requests, matching the
 * history poller's `messages.GetHistory` usage.
 */
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { ForumTopic } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';

export interface ForumTopicsResult {
  isForum: boolean;
  topics: ForumTopic[];
}

export type ForumTopicLister = (chatId: string) => Promise<ForumTopicsResult>;

// Subset of `TelegramClient` we depend on so tests can pass a stub.
export interface ForumTopicListerClient {
  invoke: TelegramClient['invoke'];
}

/** Telegram caps `GetForumTopics` at 100 per page; one page is plenty for a picker. */
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
      // `CHANNEL_FORUM_MISSING` (not a forum) is the expected case; anything
      // else is logged but still degrades to an empty list so the picker
      // never blocks saving a destination.
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
