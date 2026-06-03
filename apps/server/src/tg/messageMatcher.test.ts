import { describe, it, expect } from 'vitest';
import {
  extractMatchableEvent,
  matchSubscriptions,
  type MatchableEvent,
} from './messageMatcher.js';
import type { Subscription } from '../db/schema.js';

function makeSub(overrides: Partial<Subscription>): Subscription {
  return {
    id: 1,
    sourceChatId: '-1001234567890',
    sourceTitle: 'channel',
    handle: null,
    iconDataUrl: null,
    destinationId: 1,
    enabled: true,
    forwardingRestrictedAt: null,
    sourceAccessStatus: 'ok',
    sourceAccessCheckedAt: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

const event: MatchableEvent = {
  chatId: '-1001234567890',
  messageId: '42',
  text: '',
  hasMedia: false,
};

describe('matchSubscriptions', () => {
  it('returns the matching enabled subscription', () => {
    const subs = [makeSub({ id: 1 })];
    expect(matchSubscriptions(event, subs)).toEqual(subs);
  });

  it('skips disabled subscriptions even on a chat-id match', () => {
    const subs = [makeSub({ id: 1, enabled: false })];
    expect(matchSubscriptions(event, subs)).toEqual([]);
  });

  it('returns an empty array when no subscription matches', () => {
    const subs = [makeSub({ id: 1, sourceChatId: '-100888' })];
    expect(matchSubscriptions(event, subs)).toEqual([]);
  });

  it('returns all enabled subscriptions when multiple match (fan-out)', () => {
    const subs = [makeSub({ id: 1, enabled: false }), makeSub({ id: 2 }), makeSub({ id: 3 })];
    expect(matchSubscriptions(event, subs).map((s) => s.id)).toEqual([2, 3]);
  });
});

describe('extractMatchableEvent', () => {
  function fakeEvent(message: object | undefined): { message: typeof message } {
    return { message };
  }

  it('returns null when the message is missing', () => {
    expect(extractMatchableEvent(fakeEvent(undefined) as never)).toBeNull();
  });

  it('returns null for non-Message classNames (e.g. MessageService)', () => {
    expect(extractMatchableEvent(fakeEvent({ className: 'MessageService' }) as never)).toBeNull();
  });

  it('returns null when chatId is missing', () => {
    expect(
      extractMatchableEvent(fakeEvent({ className: 'Message', id: 1, message: 'hi' }) as never),
    ).toBeNull();
  });

  it('extracts text, hasMedia=false, no senderUsername for a plain text message', () => {
    const matched = extractMatchableEvent(
      fakeEvent({
        className: 'Message',
        id: 7,
        chatId: '-1001234567890',
        message: 'hello world',
        media: null,
      }) as never,
    );
    expect(matched).toMatchObject({
      chatId: '-1001234567890',
      messageId: '7',
      text: 'hello world',
      hasMedia: false,
    });
    expect(matched?.senderUsername).toBeUndefined();
    expect(matched?.groupedId).toBeUndefined();
  });

  it('extracts hasMedia=true when media is present', () => {
    const matched = extractMatchableEvent(
      fakeEvent({
        className: 'Message',
        id: 8,
        chatId: '-1001234567890',
        message: '',
        media: { className: 'MessageMediaPhoto' },
      }) as never,
    );
    expect(matched?.hasMedia).toBe(true);
    expect(matched?.text).toBe('');
  });

  it('extracts groupedId as a string', () => {
    const matched = extractMatchableEvent(
      fakeEvent({
        className: 'Message',
        id: 9,
        chatId: '-1001234567890',
        message: '',
        groupedId: { toString: (): string => '12345' },
      }) as never,
    );
    expect(matched?.groupedId).toBe('12345');
  });

  it('lowercases sender username and strips the @', () => {
    const matched = extractMatchableEvent(
      fakeEvent({
        className: 'Message',
        id: 10,
        chatId: '-1001234567890',
        message: 'hello',
        sender: { username: 'AliceCoder' },
      }) as never,
    );
    expect(matched?.senderUsername).toBe('alicecoder');
  });

  it('omits senderUsername when sender lacks one', () => {
    const matched = extractMatchableEvent(
      fakeEvent({
        className: 'Message',
        id: 11,
        chatId: '-1001234567890',
        message: 'hello',
        sender: {},
      }) as never,
    );
    expect(matched?.senderUsername).toBeUndefined();
  });
});
