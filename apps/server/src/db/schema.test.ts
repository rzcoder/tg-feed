import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from './testing.js';
import type { Db } from './client.js';
import {
  destinations,
  subscriptions,
  subscriptionFilters,
  appSettings,
  forwardLog,
  type ForwardLogStatus,
} from './schema.js';

describe('db schema', () => {
  let db: Db;
  let close: () => void;
  let destId: number;

  beforeEach(() => {
    ({ db, close } = createTestDb());
    const [d] = db
      .insert(destinations)
      .values({ name: 'd', chatId: '-1009999999999' })
      .returning({ id: destinations.id })
      .all();
    destId = d!.id;
  });

  afterEach(() => {
    close();
  });

  describe('destinations', () => {
    it('inserts and reads back with defaults', () => {
      const [row] = db
        .insert(destinations)
        .values({ name: 'ops', chatId: '-1009374102931', note: 'Primary ops channel' })
        .returning()
        .all();
      expect(row?.name).toBe('ops');
      expect(row?.chatId).toBe('-1009374102931');
      expect(row?.note).toBe('Primary ops channel');
      expect(row?.iconDataUrl).toBeNull();
      expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it('persists iconDataUrl when supplied', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ==';
      const [row] = db
        .insert(destinations)
        .values({ name: 'd2', chatId: '-1001111111111', iconDataUrl: dataUrl })
        .returning()
        .all();
      expect(row?.iconDataUrl).toBe(dataUrl);
    });
  });

  describe('subscriptions', () => {
    it('inserts and reads back with defaults', () => {
      const inserted = db
        .insert(subscriptions)
        .values({
          sourceChatId: '-1001234567890',
          sourceTitle: 'Test Channel',
          destinationId: destId,
        })
        .returning()
        .all();

      expect(inserted).toHaveLength(1);
      const row = inserted[0]!;
      expect(row.id).toBeGreaterThan(0);
      expect(row.sourceChatId).toBe('-1001234567890');
      expect(row.sourceTitle).toBe('Test Channel');
      expect(row.destinationId).toBe(destId);
      expect(row.handle).toBeNull();
      expect(row.iconDataUrl).toBeNull();
      expect(row.enabled).toBe(true);
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('respects an explicit enabled=false', () => {
      const [row] = db
        .insert(subscriptions)
        .values({
          sourceChatId: 's',
          sourceTitle: 't',
          destinationId: destId,
          enabled: false,
        })
        .returning()
        .all();
      expect(row?.enabled).toBe(false);
    });

    it('rejects a subscription pointing at a missing destination', () => {
      expect(() =>
        db
          .insert(subscriptions)
          .values({ sourceChatId: 's', sourceTitle: 't', destinationId: 9999 })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    });

    it('detaches subscriptions when their destination is deleted (ON DELETE SET NULL)', () => {
      db.insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationId: destId })
        .run();
      db.delete(destinations).where(eq(destinations.id, destId)).run();
      const surviving = db.select().from(subscriptions).all();
      expect(surviving).toHaveLength(1);
      expect(surviving[0]!.destinationId).toBeNull();
    });

    it('allows inserting a subscription without a destination', () => {
      const inserted = db
        .insert(subscriptions)
        .values({ sourceChatId: 'detached', sourceTitle: 't', destinationId: null })
        .returning()
        .all();
      expect(inserted[0]!.destinationId).toBeNull();
    });
  });

  describe('subscription_filters', () => {
    it('round-trips JSON params', () => {
      const [sub] = db
        .insert(subscriptions)
        .values({ sourceChatId: 's', sourceTitle: 't', destinationId: destId })
        .returning()
        .all();
      const params = { value: 'foo', caseInsensitive: true } as const;
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
        .values({ sourceChatId: 's', sourceTitle: 't', destinationId: destId })
        .returning()
        .all();
      db.insert(subscriptionFilters)
        .values([
          { subscriptionId: sub!.id, ruleType: 'has-media', params: { required: true } },
          { subscriptionId: sub!.id, ruleType: 'min-length', params: { min: 10 } },
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
          .values({
            subscriptionId: 9999,
            ruleType: 'has-media',
            params: { required: true },
          })
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
        .values({ sourceChatId: 's', sourceTitle: 't', destinationId: destId })
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
        .values({ sourceChatId: 's', sourceTitle: 't', destinationId: destId })
        .returning()
        .all();
      const [logRow] = db
        .insert(forwardLog)
        .values({ subscriptionId: sub!.id, sourceMessageId: '1', status: 'sent' })
        .returning()
        .all();

      db.delete(subscriptions).where(eq(subscriptions.id, sub!.id)).run();

      const [refetched] = db.select().from(forwardLog).where(eq(forwardLog.id, logRow!.id)).all();
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
});
