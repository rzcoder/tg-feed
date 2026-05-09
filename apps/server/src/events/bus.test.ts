import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createEventBus } from './bus.js';

const logger = createLogger({ silent: true });

describe('createEventBus', () => {
  it('drops emits when no listener is subscribed', () => {
    const bus = createEventBus({ logger });
    expect(() =>
      bus.emit({ type: 'subscription.changed', subscriptionId: 1, change: 'created' }),
    ).not.toThrow();
    expect(bus.listenerCount()).toBe(0);
  });

  it('delivers emitted events to subscribers and stamps occurredAt as ISO string', () => {
    const bus = createEventBus({ logger });
    const received: unknown[] = [];
    bus.on((event) => received.push(event));

    bus.emit({ type: 'subscription.changed', subscriptionId: 7, change: 'updated' });

    expect(received).toHaveLength(1);
    const event = received[0] as { type: string; subscriptionId: number; occurredAt: string };
    expect(event.type).toBe('subscription.changed');
    expect(event.subscriptionId).toBe(7);
    expect(typeof event.occurredAt).toBe('string');
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
  });

  it('returned unsubscribe stops further delivery', () => {
    const bus = createEventBus({ logger });
    const received: unknown[] = [];
    const unsubscribe = bus.on((event) => received.push(event));

    bus.emit({ type: 'subscription.changed', subscriptionId: 1, change: 'created' });
    unsubscribe();
    bus.emit({ type: 'subscription.changed', subscriptionId: 2, change: 'updated' });

    expect(received).toHaveLength(1);
    expect(bus.listenerCount()).toBe(0);
  });

  it('isolates listener errors: a throwing listener does not break siblings or propagate to emit', () => {
    const errSpy = vi.fn();
    const isolatedLogger = { ...logger, error: errSpy } as unknown as typeof logger;
    const bus = createEventBus({ logger: isolatedLogger });

    bus.on(() => {
      throw new Error('boom');
    });
    const sibling: unknown[] = [];
    bus.on((event) => sibling.push(event));

    expect(() =>
      bus.emit({ type: 'subscription.changed', subscriptionId: 1, change: 'created' }),
    ).not.toThrow();
    expect(sibling).toHaveLength(1);
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it('listenerCount reflects current subscriptions', () => {
    const bus = createEventBus({ logger });
    expect(bus.listenerCount()).toBe(0);
    const off1 = bus.on(() => {});
    const off2 = bus.on(() => {});
    expect(bus.listenerCount()).toBe(2);
    off1();
    expect(bus.listenerCount()).toBe(1);
    off2();
    expect(bus.listenerCount()).toBe(0);
  });

  it('a listener that unsubscribes itself during dispatch does not break iteration', () => {
    const bus = createEventBus({ logger });
    const received: number[] = [];
    const off1 = bus.on(() => {
      received.push(1);
      off1();
    });
    bus.on(() => {
      received.push(2);
    });

    bus.emit({ type: 'subscription.changed', subscriptionId: 1, change: 'created' });
    expect(received).toEqual([1, 2]);
    expect(bus.listenerCount()).toBe(1);
  });
});
