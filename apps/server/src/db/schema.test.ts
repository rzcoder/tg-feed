import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from './testing.js';
import type { Db } from './client.js';
import {
  subscriptions,
  subscriptionFilters,
  appSettings,
  forwardLog,
  tgSession,
  type ForwardLogStatus,
} from './schema.js';

describe('db schema', () => {
  let db: Db;
  let close: () => void;

  beforeEach(() => {
    ({ db, close } = createTestDb());
  });

  afterEach(() => {
    close();
  });

  describe('subscriptions', () => {
    it('inserts and reads back with defaults', () => {
      const inserted = db
        .insert(subscriptions)
        .values({
          sourceChatId: '-1001234567890',
          sourceTitle: 'Test Channel',
          destinationChatId: '-1009876543210',
        })
        .returning()
        .all();

      expect(inserted).toHaveLength(1);
      const row = inserted[0]!;
      expect(row.id).toBeGreaterThan(0);
      expect(row.sourceChatId).toBe('-1001234567890');
      expect(row.sourceTitle).toBe('Test Channel');
      expect(row.destinationChatId).toBe('-1009876543210');
      expect(row.enabled).toBe(true);
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('respects an explicit enabled=false', () => {
      const [row] = db
        .insert(subscriptions)
        .values({
          sourceChatId: 's',
          sourceTitle: 't',
          destinationChatId: 'd',
          enabled: false,
        })
        .returning()
        .all();
      expect(row?.enabled).toBe(false);
    });
  });

  describe('subscription_filters', () => {
    it('round-trips JSON params', () => {
      const [sub] = db
        .insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationChatId: 'd' })
        .returning()
        .all();
      const params = { keyword: 'foo', caseInsensitive: true, count: 3 };
      const [filter] = db
        .insert(subscriptionFilters)
        .values({
          subscriptionId: sub!.id,
          ruleType: 'text-contains',
          params,
        })
        .returning()
        .all();
      expect(filter?.params).toEqual(params);
    });

    it('cascades delete from parent subscription', () => {
      const [sub] = db
        .insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationChatId: 'd' })
        .returning()
        .all();
      db.insert(subscriptionFilters)
        .values([
          { subscriptionId: sub!.id, ruleType: 'has-media', params: { value: true } },
          { subscriptionId: sub!.id, ruleType: 'min-length', params: { value: 10 } },
        ])
        .run();
      expect(db.select().from(subscriptionFilters).all()).toHaveLength(2);

      db.delete(subscriptions).where(eq(subscriptions.id, sub!.id)).run();
      expect(db.select().from(subscriptionFilters).all()).toHaveLength(0);
    });

    it('rejects a filter pointing at a missing subscription', () => {
      expect(() =>
        db
          .insert(subscriptionFilters)
          .values({ subscriptionId: 9999, ruleType: 'noop', params: {} })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    });
  });

  describe('app_settings', () => {
    it('stores arbitrary JSON keyed by string', () => {
      db.insert(appSettings)
        .values({ key: 'global', value: { delayMs: 10000, perDestinationConcurrency: 1 } })
        .run();
      const [row] = db.select().from(appSettings).where(eq(appSettings.key, 'global')).all();
      expect(row?.value).toEqual({ delayMs: 10000, perDestinationConcurrency: 1 });
    });

    it('rejects duplicate primary key', () => {
      db.insert(appSettings).values({ key: 'k', value: 1 }).run();
      expect(() => db.insert(appSettings).values({ key: 'k', value: 2 }).run()).toThrow(
        /UNIQUE|PRIMARY KEY/i,
      );
    });
  });

  describe('forward_log', () => {
    it('inserts with default createdAt and nullable dest fields', () => {
      const [sub] = db
        .insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationChatId: 'd' })
        .returning()
        .all();
      const [row] = db
        .insert(forwardLog)
        .values({
          subscriptionId: sub!.id,
          sourceMessageId: '42',
          status: 'sent',
          destMessageId: '100',
        })
        .returning()
        .all();
      expect(row?.status).toBe('sent');
      expect(row?.destMessageId).toBe('100');
      expect(row?.error).toBeNull();
      expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it('survives subscription deletion (subscriptionId set to null)', () => {
      const [sub] = db
        .insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationChatId: 'd' })
        .returning()
        .all();
      const [logRow] = db
        .insert(forwardLog)
        .values({ subscriptionId: sub!.id, sourceMessageId: '1', status: 'sent' })
        .returning()
        .all();

      db.delete(subscriptions).where(eq(subscriptions.id, sub!.id)).run();

      const [refetched] = db.select().from(forwardLog).where(eq(forwardLog.id, logRow!.id)).all();
      expect(refetched).toBeDefined();
      expect(refetched?.subscriptionId).toBeNull();
    });

    it('rejects an unknown status via CHECK constraint', () => {
      expect(() =>
        db
          .insert(forwardLog)
          .values({
            sourceMessageId: '1',
            status: 'bogus' as ForwardLogStatus,
          })
          .run(),
      ).toThrow(/CHECK/i);
    });

    it('accepts every valid status', () => {
      const statuses: ForwardLogStatus[] = ['sent', 'filtered', 'flood_wait', 'failed'];
      for (const status of statuses) {
        db.insert(forwardLog).values({ sourceMessageId: 'x', status }).run();
      }
      expect(db.select().from(forwardLog).all()).toHaveLength(statuses.length);
    });
  });

  describe('tg_session', () => {
    it('stores encrypted strings keyed by string', () => {
      db.insert(tgSession).values({ key: 'forwarder', encryptedString: 'aes-blob' }).run();
      const [row] = db.select().from(tgSession).where(eq(tgSession.key, 'forwarder')).all();
      expect(row?.encryptedString).toBe('aes-blob');
    });

    it('rejects duplicate primary key', () => {
      db.insert(tgSession).values({ key: 'k', encryptedString: 'a' }).run();
      expect(() => db.insert(tgSession).values({ key: 'k', encryptedString: 'b' }).run()).toThrow(
        /UNIQUE|PRIMARY KEY/i,
      );
    });
  });
});
