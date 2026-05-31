import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { createSessionStore, type SessionStore } from './sessionStore.js';

describe('createSessionStore', () => {
  let handle: TestDbHandle;
  let store: SessionStore;

  beforeEach(() => {
    handle = createTestDb();
    store = createSessionStore({ db: handle.db, ttlMs: 1_000 });
  });

  afterEach(() => {
    handle.close();
  });

  it('mints opaque tokens with high entropy and verifies them', () => {
    const a = store.create();
    const b = store.create();
    expect(a).not.toBe(b);
    // base64url of 32 random bytes → 43 chars
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(store.verifyAndRefresh(a)).toBe(true);
    expect(store.verifyAndRefresh(b)).toBe(true);
  });

  it('rejects an unknown token', () => {
    expect(store.verifyAndRefresh('not-a-token')).toBe(false);
    expect(store.verifyAndRefresh('')).toBe(false);
  });

  it('expires tokens past their hard cap and deletes the row', () => {
    const token = store.create(new Date(0));
    // 2s past the 1s TTL
    expect(store.verifyAndRefresh(token, new Date(2_000))).toBe(false);
    // Subsequent lookup also rejects (row was reaped lazily).
    expect(store.verifyAndRefresh(token, new Date(2_000))).toBe(false);
  });

  it('slides expiry forward on every successful verify', () => {
    const created = new Date(0);
    const token = store.create(created);
    // Just before expiry — verify slides it.
    expect(store.verifyAndRefresh(token, new Date(900))).toBe(true);
    // Now 1.5s past original TTL but only 0.6s past the sliding refresh.
    expect(store.verifyAndRefresh(token, new Date(1_500))).toBe(true);
  });

  it('revoke deletes a session — subsequent verify fails', () => {
    const token = store.create();
    expect(store.revoke(token)).toBe(true);
    expect(store.verifyAndRefresh(token)).toBe(false);
    // Idempotent — revoking a missing token returns false but doesn't throw.
    expect(store.revoke(token)).toBe(false);
  });

  it('prune sweeps expired rows', () => {
    const t1 = store.create(new Date(0));
    const t2 = store.create(new Date(0));
    const t3 = store.create(new Date(2_000)); // in the future relative to "now"
    const deleted = store.prune(new Date(1_500));
    expect(deleted).toBe(2);
    // t3's expiry is `2000 + ttlMs` → still in the future
    expect(store.verifyAndRefresh(t3, new Date(1_500))).toBe(true);
    // The other two are gone.
    expect(store.verifyAndRefresh(t1, new Date(1_500))).toBe(false);
    expect(store.verifyAndRefresh(t2, new Date(1_500))).toBe(false);
  });
});
