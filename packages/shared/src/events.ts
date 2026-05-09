/**
 * Stream event taxonomy — the wire format for `GET /api/stream` (SSE).
 *
 * The internal event bus (`apps/server/src/events/bus.ts`) accepts a
 * `StreamEventInput` and stamps `occurredAt` to produce the `StreamEvent`
 * that goes on the wire. Per-variant fields live next to the discriminator
 * tag rather than behind `Omit<Union, 'occurredAt'>` because `Omit` doesn't
 * always preserve discriminated-union narrowing across the codebase's TS
 * surface — co-locating keeps narrowing reliable.
 *
 * `forward.filtered` peers `forward_log.status='filtered'` from Ch 6 so the
 * Ch 13 Activity feed can render filtered messages alongside forwarded ones.
 * `subscription.changed` is intentionally narrow: filter mutations do NOT
 * emit events (the Ch 11 filter UI manages its own invalidation).
 */

export const STREAM_EVENT_TYPES = [
  'forward.started',
  'forward.completed',
  'forward.failed',
  'forward.flood_wait',
  'forward.filtered',
  'subscription.changed',
] as const;
export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];

export type SubscriptionChangeKind = 'created' | 'updated' | 'deleted';

export type StreamEventInput =
  | {
      type: 'forward.started';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
    }
  | {
      type: 'forward.completed';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
      destMessageIds: string[];
    }
  | {
      type: 'forward.failed';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
      error: string;
    }
  | {
      type: 'forward.flood_wait';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
      seconds: number;
    }
  | {
      type: 'forward.filtered';
      subscriptionId: number;
      sourceMessageIds: string[];
      reasons: string[];
    }
  | {
      type: 'subscription.changed';
      subscriptionId: number;
      change: SubscriptionChangeKind;
    };

export type StreamEvent = StreamEventInput & { occurredAt: string };
