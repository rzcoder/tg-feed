// SSE wire format for GET /api/stream; the bus stamps occurredAt onto StreamEventInput.
// Fields are inlined (not Omit<Union,'occurredAt'>) so discriminated-union narrowing stays reliable.
// subscription.changed is intentionally narrow: filter mutations don't emit (the filter UI self-invalidates).

export const STREAM_EVENT_TYPES = [
  'forward.started',
  'forward.completed',
  'forward.failed',
  'forward.flood_wait',
  'forward.filtered',
  'subscription.changed',
  'destination.changed',
] as const;
export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];

export type SubscriptionChangeKind = 'created' | 'updated' | 'deleted';
export type DestinationChangeKind = 'created' | 'updated' | 'deleted';

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
      // forward_log row ids, one per sourceMessageId, same order.
      forwardLogIds: number[];
    }
  | {
      type: 'forward.failed';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
      error: string;
      forwardLogIds: number[];
    }
  | {
      type: 'forward.flood_wait';
      subscriptionId: number;
      sourceChatId: string;
      destinationChatId: string;
      sourceMessageIds: string[];
      seconds: number;
      forwardLogIds: number[];
    }
  | {
      type: 'forward.filtered';
      subscriptionId: number;
      sourceMessageIds: string[];
      reasons: string[];
      forwardLogIds: number[];
    }
  | {
      type: 'subscription.changed';
      subscriptionId: number;
      change: SubscriptionChangeKind;
    }
  | {
      type: 'destination.changed';
      destinationId: number;
      change: DestinationChangeKind;
    };

export type StreamEvent = StreamEventInput & { occurredAt: string };
