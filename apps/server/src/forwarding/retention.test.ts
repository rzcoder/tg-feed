import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { forwardLog } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import { pruneForwardLog } from './retention.js';

const logger = createLogger({ silent: true });

describe('pruneForwardLog', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = createTestDb();
  });
  afterEach(() => {
    handle.close();
  });

  function seed(n: number): void {
    const base = Date.now() - n * 1000;
    const rows = Array.from({ length: n }, (_, i) => ({
      sourceMessageId: String(i + 1),
      status: 'sent' as const,
      destMessageId: null,
      error: null,
      rawMessage: null,
      createdAt: new Date(base + i * 1000),
    }));
    handle.db.insert(forwardLog).values(rows).run();
  }

  function count(): number {
    return Number(handle.db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM forward_log`)?.c ?? 0);
  }

  it('is a no-op when row count <= maxRows', () => {
    seed(5);
    const deleted = pruneForwardLog({ db: handle.db, logger, maxRows: 10 });
    expect(deleted).toBe(0);
    expect(count()).toBe(5);
  });

  it('keeps the most recent maxRows and deletes the rest', () => {
    seed(20);
    const deleted = pruneForwardLog({ db: handle.db, logger, maxRows: 5 });
    expect(deleted).toBe(15);
    expect(count()).toBe(5);
    // The kept rows must be the ones with the highest sourceMessageId
    // (we seeded in monotonic-id order, so 16..20 survive).
    const remaining = handle.db
      .select({ id: forwardLog.sourceMessageId })
      .from(forwardLog)
      .orderBy(forwardLog.sourceMessageId)
      .all()
      .map((r) => r.id);
    expect(remaining).toEqual(['16', '17', '18', '19', '20']);
  });

  it('treats maxRows <= 0 as a no-op (safety belt)', () => {
    seed(3);
    expect(pruneForwardLog({ db: handle.db, logger, maxRows: 0 })).toBe(0);
    expect(count()).toBe(3);
  });
});
