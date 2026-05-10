import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StreamEventInput } from '@tg-feed/shared';
import type { Db } from '../db/client.js';
import {
  destinations,
  forwardLog,
  libraryFilters,
  subscriptionFilters,
  subscriptionLibraryFilters,
  subscriptions,
} from '../db/schema.js';
import { createTestDb } from '../db/testing.js';
import type { EventBus } from '../events/bus.js';
import { createLogger } from '../lib/logger.js';
import { createFilterEvaluator, evaluateFilters } from './evaluate.js';
import { createRegistry } from './registry.js';
import { createDefaultRegistry } from './rules/index.js';
import { textContainsRule } from './rules/textContains.js';
import { hasMediaRule } from './rules/hasMedia.js';
import { minLengthRule } from './rules/minLength.js';
import type { MessageContext } from './types.js';

const logger = createLogger({ silent: true });

interface StubBus extends EventBus {
  emitted: StreamEventInput[];
}

function makeStubBus(): StubBus {
  const emitted: StreamEventInput[] = [];
  return {
    emitted,
    emit(input) {
      emitted.push(input);
    },
    on() {
      return () => {};
    },
    listenerCount() {
      return 0;
    },
  };
}

function seedSubscription(db: Db): number {
  const [d] = db
    .insert(destinations)
    .values({ name: 'd', chatId: '-1009999999999' })
    .returning({ id: destinations.id })
    .all();
  const [row] = db
    .insert(subscriptions)
    .values({ sourceChatId: 'src', sourceTitle: 't', destinationId: d!.id })
    .returning()
    .all();
  return row!.id;
}

function ctx(overrides: Partial<MessageContext> = {}): MessageContext {
  return { text: '', hasMedia: false, ...overrides };
}

describe('evaluateFilters (pure)', () => {
  it('empty filter set returns pass=true with no reasons', () => {
    const result = evaluateFilters([], createDefaultRegistry(), ctx(), logger);
    expect(result).toEqual({ pass: true, reasons: [] });
  });

  it('skips unknown rule types (fail-open)', () => {
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'does-not-exist' as never,
          params: {} as never,
          label: null,
        },
      ],
      createDefaultRegistry(),
      ctx({ text: 'anything' }),
      logger,
    );
    expect(result.pass).toBe(true);
  });

  it('skips rows with invalid params (fail-open)', () => {
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'text-contains',
          params: { value: '' } as never,
          label: null,
        },
      ],
      createDefaultRegistry(),
      ctx({ text: 'anything' }),
      logger,
    );
    expect(result.pass).toBe(true);
  });

  it('skips rows whose rule throws (fail-open)', () => {
    const registry = createRegistry();
    registry.register({
      type: 'text-regex',
      label: 'Text matches regex',
      paramsSchema: textContainsRule.paramsSchema as never,
      evaluate() {
        throw new Error('boom');
      },
    } as never);
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'text-regex',
          params: { value: 'foo', caseInsensitive: true } as never,
          label: null,
        },
      ],
      registry,
      ctx({ text: 'foo' }),
      logger,
    );
    expect(result.pass).toBe(true);
  });

  it('AND-combines: one fail → fail with that reason', () => {
    const registry = createDefaultRegistry();
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true } as never,
          label: null,
        },
        {
          id: 2,
          source: 'sub',
          ruleType: 'has-media',
          params: { required: true } as never,
          label: null,
        },
      ],
      registry,
      ctx({ text: 'rust news', hasMedia: false }),
      logger,
    );
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(['has-media: no media on message']);
  });

  it('accumulates reasons in row order when multiple fail', () => {
    const registry = createDefaultRegistry();
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true } as never,
          label: null,
        },
        {
          id: 2,
          source: 'sub',
          ruleType: 'min-length',
          params: { min: 100 } as never,
          label: null,
        },
      ],
      registry,
      ctx({ text: 'short' }),
      logger,
    );
    expect(result.pass).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0]).toMatch(/^text-contains:/);
    expect(result.reasons[1]).toMatch(/^min-length:/);
  });

  it('all rules pass → pass=true', () => {
    const registry = createRegistry();
    registry.register(textContainsRule);
    registry.register(hasMediaRule);
    registry.register(minLengthRule);
    const result = evaluateFilters(
      [
        {
          id: 1,
          source: 'sub',
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true } as never,
          label: null,
        },
        {
          id: 2,
          source: 'sub',
          ruleType: 'has-media',
          params: { required: true } as never,
          label: null,
        },
      ],
      registry,
      ctx({ text: 'rust is great', hasMedia: true }),
      logger,
    );
    expect(result).toEqual({ pass: true, reasons: [] });
  });
});

describe('createFilterEvaluator (with DB)', () => {
  let db: Db;
  let close: () => void;
  let subId: number;

  beforeEach(() => {
    ({ db, close } = createTestDb());
    subId = seedSubscription(db);
  });

  afterEach(() => {
    close();
  });

  it('subscription with no filters → pass, no log row', () => {
    const evaluator = createFilterEvaluator({
      db,
      registry: createDefaultRegistry(),
      logger,
      bus: makeStubBus(),
    });
    expect(evaluator.evaluate(ctx({ text: 'whatever' }), subId, ['10'])).toEqual({
      pass: true,
    });
    expect(db.select().from(forwardLog).all()).toHaveLength(0);
  });

  it('all rules pass → no log row written', () => {
    db.insert(subscriptionFilters)
      .values({
        subscriptionId: subId,
        ruleType: 'text-contains',
        params: { value: 'rust', caseInsensitive: true },
      })
      .run();
    const evaluator = createFilterEvaluator({
      db,
      registry: createDefaultRegistry(),
      logger,
      bus: makeStubBus(),
    });
    expect(evaluator.evaluate(ctx({ text: 'rust news' }), subId, ['10'])).toEqual({
      pass: true,
    });
    expect(db.select().from(forwardLog).all()).toHaveLength(0);
  });

  it('one rule fails → writes one filtered log row per source id with joined reasons', () => {
    db.insert(subscriptionFilters)
      .values([
        {
          subscriptionId: subId,
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true },
        },
        {
          subscriptionId: subId,
          ruleType: 'min-length',
          params: { min: 50 },
        },
      ])
      .run();
    const evaluator = createFilterEvaluator({
      db,
      registry: createDefaultRegistry(),
      logger,
      bus: makeStubBus(),
    });
    expect(evaluator.evaluate(ctx({ text: 'short' }), subId, ['10', '11', '12'])).toEqual({
      pass: false,
    });
    const rows = db.select().from(forwardLog).all();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sourceMessageId).sort()).toEqual(['10', '11', '12']);
    for (const row of rows) {
      expect(row.status).toBe('filtered');
      expect(row.subscriptionId).toBe(subId);
      expect(row.destMessageId).toBeNull();
      expect(row.error).toMatch(/text-contains:/);
      expect(row.error).toMatch(/min-length:/);
      expect(row.error).toContain('; ');
    }
  });

  it('disabled filter row is ignored', () => {
    db.insert(subscriptionFilters)
      .values({
        subscriptionId: subId,
        ruleType: 'text-contains',
        params: { value: 'rust', caseInsensitive: true },
        enabled: false,
      })
      .run();
    const evaluator = createFilterEvaluator({
      db,
      registry: createDefaultRegistry(),
      logger,
      bus: makeStubBus(),
    });
    expect(evaluator.evaluate(ctx({ text: 'no match here' }), subId, ['10'])).toEqual({
      pass: true,
    });
    expect(db.select().from(forwardLog).all()).toHaveLength(0);
  });

  it('reasons preserve filter id ordering', () => {
    db.insert(subscriptionFilters)
      .values([
        {
          subscriptionId: subId,
          ruleType: 'min-length',
          params: { min: 100 },
        },
        {
          subscriptionId: subId,
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true },
        },
      ])
      .run();
    const evaluator = createFilterEvaluator({
      db,
      registry: createDefaultRegistry(),
      logger,
      bus: makeStubBus(),
    });
    evaluator.evaluate(ctx({ text: 'no' }), subId, ['10']);
    const [row] = db.select().from(forwardLog).where(eq(forwardLog.subscriptionId, subId)).all();
    const reasons = row!.error!.split('; ');
    expect(reasons[0]).toMatch(/^min-length:/);
    expect(reasons[1]).toMatch(/^text-contains:/);
  });

  describe('bus emission', () => {
    it('emits forward.filtered with reasons on rejection', () => {
      db.insert(subscriptionFilters)
        .values({
          subscriptionId: subId,
          ruleType: 'min-length',
          params: { min: 100 },
        })
        .run();
      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });

      const result = evaluator.evaluate(ctx({ text: 'no' }), subId, ['10', '11']);

      expect(result).toEqual({ pass: false });
      expect(bus.emitted).toHaveLength(1);
      expect(bus.emitted[0]).toMatchObject({
        type: 'forward.filtered',
        subscriptionId: subId,
        sourceMessageIds: ['10', '11'],
      });
      const filtered = bus.emitted[0] as Extract<StreamEventInput, { type: 'forward.filtered' }>;
      expect(filtered.reasons).toHaveLength(1);
      expect(filtered.reasons[0]).toMatch(/^min-length:/);
    });

    it('does not emit on pass', () => {
      db.insert(subscriptionFilters)
        .values({
          subscriptionId: subId,
          ruleType: 'text-contains',
          params: { value: 'rust', caseInsensitive: true },
        })
        .run();
      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });

      evaluator.evaluate(ctx({ text: 'rust news' }), subId, ['10']);
      expect(bus.emitted).toHaveLength(0);
    });

    it('does not emit on empty filter set (vacuous pass)', () => {
      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });

      evaluator.evaluate(ctx({ text: 'anything' }), subId, ['10']);
      expect(bus.emitted).toHaveLength(0);
    });
  });

  describe('library filters integration', () => {
    function attachLibrary(
      db: Db,
      subId: number,
      name: string,
      ruleType: string,
      params: object,
    ): number {
      const [row] = db
        .insert(libraryFilters)
        .values({ name, ruleType: ruleType as never, params: params as never })
        .returning({ id: libraryFilters.id })
        .all();
      db.insert(subscriptionLibraryFilters)
        .values({ subscriptionId: subId, libraryFilterId: row!.id })
        .run();
      return row!.id;
    }

    it('library rule failure emits library: prefix in reasons', () => {
      attachLibrary(db, subId, 'No #реклама', 'text-excludes', {
        value: '#реклама',
        caseInsensitive: true,
      });
      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });

      evaluator.evaluate(ctx({ text: 'check out our deals #реклама' }), subId, ['10']);
      expect(bus.emitted).toHaveLength(1);
      const filtered = bus.emitted[0] as Extract<StreamEventInput, { type: 'forward.filtered' }>;
      expect(filtered.reasons).toHaveLength(1);
      expect(filtered.reasons[0]).toMatch(/^library:No #реклама: text-excludes: /);
    });

    it('library + per-sub filters AND together — library reasons before per-sub', () => {
      attachLibrary(db, subId, 'No promo', 'text-excludes', {
        value: '#promo',
        caseInsensitive: true,
      });
      db.insert(subscriptionFilters)
        .values({
          subscriptionId: subId,
          ruleType: 'min-length',
          params: { min: 100 },
        })
        .run();

      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });
      evaluator.evaluate(ctx({ text: '#promo short' }), subId, ['10']);

      const filtered = bus.emitted[0] as Extract<StreamEventInput, { type: 'forward.filtered' }>;
      expect(filtered.reasons).toHaveLength(2);
      expect(filtered.reasons[0]).toMatch(/^library:No promo:/);
      expect(filtered.reasons[1]).toMatch(/^min-length:/);
    });

    it('detached library filter does not apply', () => {
      const libId = attachLibrary(db, subId, 'No promo', 'text-excludes', {
        value: '#promo',
        caseInsensitive: true,
      });
      // Detach
      db.delete(subscriptionLibraryFilters)
        .where(eq(subscriptionLibraryFilters.libraryFilterId, libId))
        .run();

      const bus = makeStubBus();
      const evaluator = createFilterEvaluator({
        db,
        registry: createDefaultRegistry(),
        logger,
        bus,
      });
      const result = evaluator.evaluate(ctx({ text: '#promo deal' }), subId, ['10']);
      expect(result.pass).toBe(true);
      expect(bus.emitted).toHaveLength(0);
    });
  });
});
