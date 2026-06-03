import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@tg-feed/shared';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { destinations, subscriptions } from '../db/schema.js';
import { createEventBus, type EventBus } from '../events/bus.js';
import { FloodWaitError } from '../forwarding/floodwait.js';
import { createLogger } from '../lib/logger.js';
import { createAccessMonitor, type AccessProbeClient } from './accessMonitor.js';

const logger = createLogger({ silent: true });

interface TestSetup {
  dbHandle: TestDbHandle;
  bus: EventBus;
  busEvents: StreamEvent[];
  destId: number;
  subId: number;
}

function setup(): TestSetup {
  const dbHandle = createTestDb();
  const bus = createEventBus({ logger });
  const busEvents: StreamEvent[] = [];
  bus.on((event) => {
    busEvents.push(event);
  });

  const dest = dbHandle.db
    .insert(destinations)
    .values({ name: 'primary', chatId: '-1009999999999' })
    .returning({ id: destinations.id })
    .all();
  const destId = dest[0]!.id;

  const sub = dbHandle.db
    .insert(subscriptions)
    .values({
      sourceChatId: '-1001111111111',
      sourceTitle: 'Source A',
      destinationId: destId,
    })
    .returning({ id: subscriptions.id })
    .all();
  const subId = sub[0]!.id;

  return { dbHandle, bus, busEvents, destId, subId };
}

function makeClient(behaviour: (chatId: string) => Promise<unknown>): AccessProbeClient {
  return { getEntity: vi.fn(behaviour) };
}

describe('createAccessMonitor', () => {
  let s: TestSetup;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.dbHandle.close();
  });

  it('marks subs and destinations as no_access when getEntity throws', async () => {
    const client = makeClient(() => Promise.reject(new Error('CHANNEL_PRIVATE')));
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      // Single-probe flip — the production default (3) is exercised by the
      // dedicated hysteresis test further down.
      noAccessFailThreshold: 1,
    });

    await monitor.probe();

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.sourceAccessStatus).toBe('no_access');
    expect(subRow?.sourceAccessCheckedAt).toBeInstanceOf(Date);

    const destRow = s.dbHandle.db
      .select()
      .from(destinations)
      .where(eq(destinations.id, s.destId))
      .get();
    expect(destRow?.accessStatus).toBe('no_access');
    expect(destRow?.accessCheckedAt).toBeInstanceOf(Date);

    const subEvents = s.busEvents.filter((e) => e.type === 'subscription.changed');
    const destEvents = s.busEvents.filter((e) => e.type === 'destination.changed');
    expect(subEvents).toHaveLength(1);
    expect(destEvents).toHaveLength(1);
    monitor.stop();
  });

  it('does not emit events when status is unchanged (still ok)', async () => {
    const client = makeClient(() => Promise.resolve({}));
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
    });

    await monitor.probe();
    expect(s.busEvents).toHaveLength(0);

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    // checked_at is still updated on a no-op transition.
    expect(subRow?.sourceAccessStatus).toBe('ok');
    expect(subRow?.sourceAccessCheckedAt).toBeInstanceOf(Date);
    monitor.stop();
  });

  it('emits a single event on recovery: no_access → ok', async () => {
    let shouldFail = true;
    const client = makeClient(() =>
      shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve({}),
    );
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      noAccessFailThreshold: 1,
    });

    await monitor.probe();
    s.busEvents.length = 0;

    shouldFail = false;
    await monitor.probe();

    const subEvents = s.busEvents.filter((e) => e.type === 'subscription.changed');
    const destEvents = s.busEvents.filter((e) => e.type === 'destination.changed');
    expect(subEvents).toHaveLength(1);
    expect(destEvents).toHaveLength(1);

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.sourceAccessStatus).toBe('ok');
    monitor.stop();
  });

  it('skips disabled subscriptions and ignores destinations that are no longer referenced', async () => {
    s.dbHandle.db
      .update(subscriptions)
      .set({ enabled: false })
      .where(eq(subscriptions.id, s.subId))
      .run();

    const seen: string[] = [];
    const client = makeClient((chatId) => {
      seen.push(chatId);
      return Promise.resolve({});
    });
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
    });

    await monitor.probe();
    // Disabled sub's source is skipped; destination is still checked even
    // when its sole subscription is disabled.
    expect(seen).toEqual(['-1009999999999']);
    monitor.stop();
  });

  it('dedupes when same chatId appears as both source and destination', async () => {
    // Point destination to the same chatId the subscription's source uses.
    s.dbHandle.db
      .update(destinations)
      .set({ chatId: '-1001111111111' })
      .where(eq(destinations.id, s.destId))
      .run();

    const seen: string[] = [];
    const client = makeClient((chatId) => {
      seen.push(chatId);
      return Promise.resolve({});
    });
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
    });

    await monitor.probe();
    expect(seen).toEqual(['-1001111111111']);
    monitor.stop();
  });

  it('retries once after a FloodWaitError, succeeds on retry', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      if (calls === 1)
        return Promise.reject(new FloodWaitError({ request: undefined, seconds: 0 }));
      return Promise.resolve({});
    });
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
    });

    await monitor.probe();
    // First chat: fail then retry succeed = 2 calls. Second chat: 1 call. Total 3.
    expect(calls).toBe(3);

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.sourceAccessStatus).toBe('ok');
    monitor.stop();
  });

  it('stop prevents further probes', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      return Promise.resolve({});
    });
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
    });

    monitor.stop();
    await monitor.probe();
    expect(calls).toBe(0);
  });

  it('backfills iconDataUrl when probe is ok and the row is icon-less', async () => {
    const client = makeClient(() => Promise.resolve({}));
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ==';
    const fetchProfilePhoto = vi.fn().mockResolvedValue(dataUrl);
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      fetchProfilePhoto,
    });

    await monitor.probe();

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    const destRow = s.dbHandle.db
      .select()
      .from(destinations)
      .where(eq(destinations.id, s.destId))
      .get();
    expect(subRow?.iconDataUrl).toBe(dataUrl);
    expect(destRow?.iconDataUrl).toBe(dataUrl);
    expect(fetchProfilePhoto).toHaveBeenCalledWith('-1001111111111');
    expect(fetchProfilePhoto).toHaveBeenCalledWith('-1009999999999');
    monitor.stop();
  });

  it('does not call fetchProfilePhoto when row already has iconDataUrl', async () => {
    s.dbHandle.db
      .update(subscriptions)
      .set({ iconDataUrl: 'data:image/jpeg;base64,old' })
      .where(eq(subscriptions.id, s.subId))
      .run();
    s.dbHandle.db
      .update(destinations)
      .set({ iconDataUrl: 'data:image/jpeg;base64,old' })
      .where(eq(destinations.id, s.destId))
      .run();

    const client = makeClient(() => Promise.resolve({}));
    const fetchProfilePhoto = vi.fn().mockResolvedValue('data:image/jpeg;base64,new');
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      fetchProfilePhoto,
    });

    await monitor.probe();

    expect(fetchProfilePhoto).not.toHaveBeenCalled();
    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.iconDataUrl).toBe('data:image/jpeg;base64,old');
    monitor.stop();
  });

  it('skips icon backfill when probe is no_access', async () => {
    const client = makeClient(() => Promise.reject(new Error('CHANNEL_PRIVATE')));
    const fetchProfilePhoto = vi.fn().mockResolvedValue('data:image/jpeg;base64,xx');
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      noAccessFailThreshold: 1,
      fetchProfilePhoto,
    });

    await monitor.probe();

    expect(fetchProfilePhoto).not.toHaveBeenCalled();
    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.iconDataUrl).toBeNull();
    monitor.stop();
  });

  it('leaves iconDataUrl null when fetchProfilePhoto returns null (retry next sweep)', async () => {
    const client = makeClient(() => Promise.resolve({}));
    const fetchProfilePhoto = vi.fn().mockResolvedValue(null);
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      fetchProfilePhoto,
    });

    await monitor.probe();

    expect(fetchProfilePhoto).toHaveBeenCalled();
    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(subRow?.iconDataUrl).toBeNull();
    monitor.stop();
  });

  it('does not flip ok→no_access on a single failure when threshold > 1 (hysteresis)', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      return Promise.reject(new Error('CHANNEL_PRIVATE'));
    });
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      noAccessFailThreshold: 3,
    });

    // First failure: badge stays `ok` (hysteresis), but `checked_at` updates.
    await monitor.probe();
    const sub1 = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(sub1?.sourceAccessStatus).toBe('ok');
    // Second failure: still `ok`.
    await monitor.probe();
    const sub2 = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(sub2?.sourceAccessStatus).toBe('ok');
    // Third failure crosses the threshold — now flip.
    await monitor.probe();
    const sub3 = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    expect(sub3?.sourceAccessStatus).toBe('no_access');
    // No flapping events from the under-threshold sweeps; only the final one.
    const subFlipEvents = s.busEvents.filter((e) => e.type === 'subscription.changed');
    expect(subFlipEvents.length).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(3);
    monitor.stop();
  });

  it('preserves each target status under threshold for a mixed-status shared chatId', async () => {
    // Same chat is both the subscription source and a destination, with divergent
    // persisted statuses — an under-threshold sweep must not clobber either badge.
    s.dbHandle.db
      .update(destinations)
      .set({ chatId: '-1001111111111', accessStatus: 'no_access' })
      .where(eq(destinations.id, s.destId))
      .run();
    s.dbHandle.db
      .update(subscriptions)
      .set({ sourceAccessStatus: 'ok' })
      .where(eq(subscriptions.id, s.subId))
      .run();

    const client = makeClient(() => Promise.reject(new Error('CHANNEL_PRIVATE')));
    const monitor = createAccessMonitor({
      client,
      db: s.dbHandle.db,
      bus: s.bus,
      logger,
      intervalMs: 100,
      noAccessFailThreshold: 3, // single sweep stays under the threshold
    });

    await monitor.probe();

    const subRow = s.dbHandle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, s.subId))
      .get();
    const destRow = s.dbHandle.db
      .select()
      .from(destinations)
      .where(eq(destinations.id, s.destId))
      .get();
    // Each keeps its own prior status; the destination's no_access is NOT cleared to ok.
    expect(subRow?.sourceAccessStatus).toBe('ok');
    expect(destRow?.accessStatus).toBe('no_access');
    // Freshness still bumped on both, and no status change means no events.
    expect(subRow?.sourceAccessCheckedAt).toBeInstanceOf(Date);
    expect(destRow?.accessCheckedAt).toBeInstanceOf(Date);
    expect(s.busEvents).toHaveLength(0);
    monitor.stop();
  });
});
