import type { NewMessageEvent } from 'telegram/events/index.js';
import type { Subscription } from '../db/schema.js';
import type { MessageLink } from '../filters/types.js';
import { extractMessageEntities, type MessageEntityLike } from './entities.js';

// Subscription row plus the JOIN-resolved destination chat/topic.
export type ResolvedSubscription = Subscription & {
  destinationChatId: string;
  destinationTopicId: string | null;
};

export interface MatchableEvent {
  chatId: string;
  messageId: string;
  groupedId?: string;
  text: string; // empty string for media-only messages
  hasMedia: boolean;
  senderUsername?: string; // lowercased, no '@'; undefined for anonymous channel posts
  entityTexts: string[]; // hidden hyperlink targets + code-block languages
  links: MessageLink[];
}

export function extractMatchableEvent(event: NewMessageEvent): MatchableEvent | null {
  const message = event.message;
  if (!message || message.className !== 'Message') return null;
  const chatId = message.chatId;
  if (!chatId) return null;
  const groupedId = message.groupedId?.toString();
  const text = typeof message.message === 'string' ? message.message : '';
  const hasMedia = message.media != null;
  const senderUsername = extractSenderUsername(message);
  const { entityTexts, links } = extractMessageEntities(
    text,
    message.entities as MessageEntityLike[] | undefined,
  );
  return {
    chatId: chatId.toString(),
    messageId: message.id.toString(),
    text,
    hasMedia,
    entityTexts,
    links,
    ...(groupedId !== undefined ? { groupedId } : {}),
    ...(senderUsername !== undefined ? { senderUsername } : {}),
  };
}

function extractSenderUsername(message: { sender?: unknown }): string | undefined {
  const sender = message.sender;
  if (
    sender != null &&
    typeof sender === 'object' &&
    'username' in sender &&
    typeof (sender as { username?: unknown }).username === 'string'
  ) {
    const username = (sender as { username: string }).username;
    if (username.length > 0) return username.toLowerCase();
  }
  return undefined;
}

// All enabled subscriptions for the event's source chat — a source may fan out to several.
export function matchSubscriptions<T extends Subscription>(
  event: MatchableEvent,
  subscriptions: readonly T[],
): T[] {
  return subscriptions.filter((s) => s.enabled && s.sourceChatId === event.chatId);
}
