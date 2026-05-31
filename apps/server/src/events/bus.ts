/**
 * In-process event bus.
 *
 * Producers (forwarder, filter evaluator, subscription routes) call `emit`
 * with a `StreamEventInput`; the bus stamps `occurredAt` and broadcasts to
 * every subscriber. The SSE route is the only consumer in v1, but the bus
 * stays general so future consumers (metrics, audit log, etc.) can attach
 * without coupling to producers.
 *
 * Implementation choice: a plain `Set<Listener>` instead of
 * `node:events.EventEmitter`. `EventEmitter.emit` rethrows synchronously
 * when a listener throws, which would propagate a buggy SSE write back up
 * into a forwarding-pipeline call site. We catch per-listener errors here,
 * log them, and keep going. `listenerCount()` becomes `set.size` — used by
 * the SSE cleanup test to verify unsubscribe ran on disconnect.
 *
 * Listener iteration snapshots the set first (`[...listeners]`) so a
 * listener that unsubscribes itself during dispatch doesn't mutate the
 * iterator mid-loop.
 */
import type { StreamEvent, StreamEventInput } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';

export type StreamEventListener = (event: StreamEvent) => void;

export interface EventBus {
  emit(input: StreamEventInput): void;
  on(listener: StreamEventListener): () => void;
  listenerCount(): number;
}

export interface CreateEventBusDeps {
  logger: Logger;
}

export function createEventBus(deps: CreateEventBusDeps): EventBus {
  const { logger } = deps;
  const listeners = new Set<StreamEventListener>();

  return {
    emit(input) {
      const event: StreamEvent = { ...input, occurredAt: new Date().toISOString() };
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          logger.error({ err, type: event.type }, 'event bus listener threw');
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount() {
      return listeners.size;
    },
  };
}
