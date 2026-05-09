import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { senderAllowlistRule } from './senderAllowlist.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('senderAllowlistRule', () => {
  it('passes when senderUsername is in the list', () => {
    expect(
      senderAllowlistRule.evaluate(ctx({ senderUsername: 'alice' }), {
        usernames: ['alice', 'bob'],
      }),
    ).toEqual({ pass: true });
  });

  it('matches case-insensitively', () => {
    expect(
      senderAllowlistRule.evaluate(ctx({ senderUsername: 'alice' }), {
        usernames: ['ALICE'],
      }),
    ).toEqual({ pass: true });
  });

  it('fails when sender is not in the list', () => {
    const result = senderAllowlistRule.evaluate(ctx({ senderUsername: 'eve' }), {
      usernames: ['alice', 'bob'],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/eve.*not in allowlist/);
  });

  it('fails with specific reason when sender info is absent', () => {
    const result = senderAllowlistRule.evaluate(ctx({}), { usernames: ['alice'] });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no sender info/);
  });
});
