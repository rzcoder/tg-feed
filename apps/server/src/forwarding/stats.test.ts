import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { forwardLog } from '../db/schema.js';
import type { ForwardLogStatus } from '@tg-feed/shared';
import { getDigestStats } from './stats.js';

describe('getDigestStats', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = createTestDb();
  });
  afterEach(() => {
    handle.close();
  });

  function insert(status: ForwardLogStatus, atMs: number): void {
    handle.db
      .insert(forwardLog)
      .values({
        sourceMessageId: '1',
        status,
        destMessageId: null,
        error: null,
        rawMessage: null,
        createdAt: new Date(atMs),
      })
      .run();
  }

  it('counts rows by status within the window', () => {
    const t = 1_700_000_000_000;
    insert('sent', t + 10);
    insert('sent', t + 20);
    insert('filtered', t + 30);
    insert('failed', t + 40);
    insert('flood_wait', t + 50);

    expect(getDigestStats(handle.db, t, t + 100)).toEqual({
      forwarded: 2,
      filtered: 1,
      failed: 1,
      floodWait: 1,
    });
  });

  it('treats the window as half-open [since, until)', () => {
    const t = 1_700_000_000_000;
    insert('sent', t - 1); // before since → excluded
    insert('sent', t); // == since → included
    insert('sent', t + 50); // inside → included
    insert('sent', t + 100); // == until → excluded

    expect(getDigestStats(handle.db, t, t + 100).forwarded).toBe(2);
  });

  it('returns zeros when no rows fall in the window', () => {
    insert('sent', 500);
    expect(getDigestStats(handle.db, 1000, 2000)).toEqual({
      forwarded: 0,
      filtered: 0,
      failed: 0,
      floodWait: 0,
    });
  });
});
