import { describe, expect, it } from 'vitest';
import { isBotAdmin, resolveWebAppUrl } from './bot.js';

describe('isBotAdmin', () => {
  const admins = ['111', '222'];

  it('matches a numeric id against the string allowlist', () => {
    expect(isBotAdmin(admins, 111)).toBe(true);
    expect(isBotAdmin(admins, '222')).toBe(true);
  });

  it('rejects ids not on the list', () => {
    expect(isBotAdmin(admins, 333)).toBe(false);
  });

  it('rejects an undefined sender', () => {
    expect(isBotAdmin(admins, undefined)).toBe(false);
  });

  it('rejects everyone when the allowlist is empty', () => {
    expect(isBotAdmin([], 111)).toBe(false);
  });
});

describe('resolveWebAppUrl', () => {
  it('accepts an https URL', () => {
    expect(resolveWebAppUrl('https://tg-feed.example.com')).toBe('https://tg-feed.example.com');
  });

  it('rejects http and other schemes (Mini Apps require HTTPS)', () => {
    expect(resolveWebAppUrl('http://localhost:3000')).toBeUndefined();
    expect(resolveWebAppUrl('ftp://x')).toBeUndefined();
  });

  it('returns undefined when unset', () => {
    expect(resolveWebAppUrl(undefined)).toBeUndefined();
  });
});
