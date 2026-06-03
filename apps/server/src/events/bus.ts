// Plain Set, not EventEmitter, so a throwing listener can't rethrow into a forwarding-pipeline call site.
// Dispatch snapshots the set so a listener unsubscribing itself mid-loop doesn't mutate the iterator.
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
