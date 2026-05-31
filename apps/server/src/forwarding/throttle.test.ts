import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { appSettings } from '../db/schema.js';
import { DEFAULT_DELAY_MS, GLOBAL_SETTINGS_KEY, getGlobalDelayMs } from './throttle.js';

describe('getGlobalDelayMs', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = createTestDb();
  });

  afterEach(() => {
    handle.close();
  });

  it('returns the default when the row is missing', () => {
    expect(getGlobalDelayMs(handle.db)).toBe(DEFAULT_DELAY_MS);
  });

  it('returns the configured delay when present and positive', () => {
    handle.db
      .insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value: { delayMs: 12000 } })
      .run();
    expect(getGlobalDelayMs(handle.db)).toBe(12000);
  });

  it.each([
    ['missing field', { other: 1 }],
    ['non-number', { delayMs: 'fast' }],
    ['zero', { delayMs: 0 }],
    ['negative', { delayMs: -1 }],
    ['NaN', { delayMs: Number.NaN }],
    ['non-object', 'plain'],
  ])('falls back to default for %s', (_label, value) => {
    handle.db.insert(appSettings).values({ key: GLOBAL_SETTINGS_KEY, value }).run();
    expect(getGlobalDelayMs(handle.db)).toBe(DEFAULT_DELAY_MS);
  });
});
