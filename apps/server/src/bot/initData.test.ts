import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from './initData.js';
import { signInitData, TEST_BOT_TOKEN as BOT_TOKEN } from './testing.js';

function freshFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 777, first_name: 'Ada', username: 'ada' }),
    ...overrides,
  };
}

describe('verifyTelegramInitData', () => {
  it('accepts a correctly-signed payload and extracts the user', () => {
    const initData = signInitData(freshFields());
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user).toEqual({
        id: '777',
        firstName: 'Ada',
        lastName: null,
        username: 'ada',
      });
    }
  });

  it('rejects a tampered hash', () => {
    const initData = signInitData(freshFields());
    const tampered = initData.replace(/hash=[0-9a-f]+/, 'hash=' + 'd'.repeat(64));
    const result = verifyTelegramInitData(tampered, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it('rejects a payload signed with a different bot token', () => {
    const initData = signInitData(freshFields(), 'other:token');
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it('rejects a mutated field (user swapped after signing)', () => {
    const initData = signInitData(freshFields());
    const mutated = initData.replace(
      /user=[^&]+/,
      'user=' + encodeURIComponent(JSON.stringify({ id: 999, first_name: 'Mallory' })),
    );
    const result = verifyTelegramInitData(mutated, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale auth_date beyond maxAgeSec', () => {
    const old = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
    const initData = signInitData(freshFields({ auth_date: String(old) }));
    const result = verifyTelegramInitData(initData, BOT_TOKEN, { maxAgeSec: 60 });
    expect(result.ok).toBe(false);
  });

  it('rejects missing hash', () => {
    const result = verifyTelegramInitData('auth_date=1&user=%7B%7D', BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(verifyTelegramInitData('', BOT_TOKEN).ok).toBe(false);
    expect(verifyTelegramInitData(signInitData(freshFields()), '').ok).toBe(false);
  });

  it('preserves a 64-bit user id exactly (no float rounding)', () => {
    const bigId = '9007199254740993'; // 2^53 + 1, not representable as a JS number
    const initData = signInitData(freshFields({ user: `{"id":${bigId},"first_name":"Ada"}` }));
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(bigId);
  });
});
