import { describe, it, expect, afterEach } from 'vitest';
import { createDb, type DbHandle } from './client.js';

describe('createDb', () => {
  let handle: DbHandle | undefined;

  afterEach(() => {
    handle?.sqlite.close();
    handle = undefined;
  });

  it('opens an in-memory DB with WAL + foreign_keys pragmas applied', () => {
    handle = createDb(':memory:');
    // SQLite returns `memory` for journal_mode on `:memory:` databases (WAL is
    // disallowed in-memory), but the pragma call must succeed and the FK pragma
    // must take effect.
    const fk = handle.sqlite.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('opens a file-backed DB with WAL journal mode', () => {
    // Use Node's os.tmpdir via require to avoid pulling more imports
    const tmp = `/tmp/tg-feed-client-test-${process.pid}-${Date.now()}.sqlite`;
    handle = createDb(tmp);
    const journalMode = handle.sqlite.pragma('journal_mode', { simple: true });
    expect(String(journalMode).toLowerCase()).toBe('wal');
    const fk = handle.sqlite.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });
});
