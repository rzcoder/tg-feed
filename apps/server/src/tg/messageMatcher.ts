import type { NewMessageEvent } from 'telegram/events/index.js';
import type { Subscription } from '../db/schema.js';

/**
 * Subscription with destination chat id resolved via JOIN. The listener
 * needs `destinationChatId` to enqueue forward jobs but the
 * `subscriptions` row only carries a FK now (`destinationId`).
 */
export type ResolvedSubscription = Subscription & { destinationChatId: string };

export interface MatchableEvent {
  chatId: string;
  messageId: string;
  groupedId?: string;
  /** Body text (or empty string for media-only messages without caption). */
  text: string;
  hasMedia: boolean;
  /** Lowercased sender username, no leading '@'. Undefined for anonymous channel posts. */
  senderUsername?: string;
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
  return {
    chatId: chatId.toString(),
    messageId: message.id.toString(),
    text,
    hasMedia,
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

export function matchSubscription<T extends Subscription>(
  event: MatchableEvent,
  subscriptions: readonly T[],
): T | undefined {
  return subscriptions.find((s) => s.enabled && s.sourceChatId === event.chatId);
}
