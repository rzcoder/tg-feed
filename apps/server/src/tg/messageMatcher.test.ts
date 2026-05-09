import { describe, it, expect } from 'vitest';
import { matchSubscription, type MatchableEvent } from './messageMatcher.js';
import type { Subscription } from '../db/schema.js';

function makeSub(overrides: Partial<Subscription>): Subscription {
  return {
    id: 1,
    sourceChatId: '-1001234567890',
    sourceTitle: 'channel',
    destinationChatId: '-100999',
    enabled: true,
    createdAt: new Date(0),
    ...overrides,
  };
}

const event: MatchableEvent = { chatId: '-1001234567890', messageId: '42' };

describe('matchSubscription', () => {
  it('returns the matching enabled subscription', () => {
    const subs = [makeSub({ id: 1 })];
    expect(matchSubscription(event, subs)).toEqual(subs[0]);
  });

  it('skips disabled subscriptions even on a chat-id match', () => {
    const subs = [makeSub({ id: 1, enabled: false })];
    expect(matchSubscription(event, subs)).toBeUndefined();
  });

  it('returns undefined when no subscription matches', () => {
    const subs = [makeSub({ id: 1, sourceChatId: '-100888' })];
    expect(matchSubscription(event, subs)).toBeUndefined();
  });

  it('returns the first enabled subscription when multiple match', () => {
    const subs = [makeSub({ id: 1, enabled: false }), makeSub({ id: 2 }), makeSub({ id: 3 })];
    expect(matchSubscription(event, subs)?.id).toBe(2);
  });
});
