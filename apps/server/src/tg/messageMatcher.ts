import type { NewMessageEvent } from 'telegram/events/index.js';
import type { Subscription } from '../db/schema.js';

export interface MatchableEvent {
  chatId: string;
  messageId: string;
}

export function extractMatchableEvent(event: NewMessageEvent): MatchableEvent | null {
  const message = event.message;
  if (!message || message.className !== 'Message') return null;
  const chatId = message.chatId;
  if (!chatId) return null;
  return { chatId: chatId.toString(), messageId: message.id.toString() };
}

export function matchSubscription(
  event: MatchableEvent,
  subscriptions: readonly Subscription[],
): Subscription | undefined {
  return subscriptions.find((s) => s.enabled && s.sourceChatId === event.chatId);
}
