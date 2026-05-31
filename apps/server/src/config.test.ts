import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('applies defaults for an empty env', () => {
    const cfg = parseConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.DATABASE_PATH).toBe('./data/tg-feed.sqlite');
    expect(cfg.TG_API_ID).toBeUndefined();
    expect(cfg.WEB_PASSWORD).toBeUndefined();
  });

  it('coerces PORT and TG_API_ID from string env values', () => {
    const cfg = parseConfig({ PORT: '8080', TG_API_ID: '12345' });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.TG_API_ID).toBe(12345);
  });

  it('rejects non-numeric PORT', () => {
    expect(() => parseConfig({ PORT: 'abc' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => parseConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a SESSION_SECRET shorter than 32 chars', () => {
    expect(() => parseConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('defaults TG_BOT_ADMIN_IDS to an empty array when unset', () => {
    expect(parseConfig({}).TG_BOT_ADMIN_IDS).toEqual([]);
  });

  it('parses, trims, and dedupes TG_BOT_ADMIN_IDS', () => {
    const cfg = parseConfig({ TG_BOT_ADMIN_IDS: ' 111, 222 ,111, ,333 ' });
    expect(cfg.TG_BOT_ADMIN_IDS).toEqual(['111', '222', '333']);
  });

  it('rejects a non-URL PUBLIC_URL', () => {
    expect(() => parseConfig({ PUBLIC_URL: 'not-a-url' })).toThrow(/PUBLIC_URL/);
  });

  it('accepts a valid https PUBLIC_URL and bot token', () => {
    const cfg = parseConfig({
      PUBLIC_URL: 'https://tg-feed.example.com',
      TG_BOT_TOKEN: '123:abc',
    });
    expect(cfg.PUBLIC_URL).toBe('https://tg-feed.example.com');
    expect(cfg.TG_BOT_TOKEN).toBe('123:abc');
  });
});
