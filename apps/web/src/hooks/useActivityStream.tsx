/**
 * SSE stream singleton.
 *
 * `StreamProvider` opens one EventSource on `/api/stream` for the whole app
 * (mounted in AppShell). All consumers — sidebar/top-bar connection pill,
 * activity page event feed — read from the same source via `useActivityStream`.
 *
 * The hook tracks connection state (`'live' | 'reconnect' | 'down'`) and
 * exposes the latest `forward.*` event. `subscription.changed` events
 * trigger a query invalidation directly on the shared QueryClient.
 *
 * EventSource auto-reconnects with browser-controlled backoff. We surface
 * readyState transitions as `'reconnect'` while connecting and `'live'`
 * once OPEN.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StreamEvent } from '@tg-feed/shared';
import { DESTINATIONS_KEY } from './useDestinations';
import { SUBSCRIPTIONS_KEY } from './useSubscriptions';

export type ConnectionState = 'live' | 'reconnect' | 'down';

export interface ActivityStreamHandle {
  state: ConnectionState;
  /** Last received forward.* event (excluding started). New event = new identity. */
  lastEvent: StreamEvent | null;
}

const FORWARD_EVENT_TYPES = new Set([
  'forward.completed',
  'forward.failed',
  'forward.flood_wait',
  'forward.filtered',
]);

const StreamContext = createContext<ActivityStreamHandle | null>(null);

export function StreamProvider({
  children,
  url = '/api/stream',
}: {
  children: ReactNode;
  url?: string;
}) {
  const [state, setState] = useState<ConnectionState>('reconnect');
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(url, { withCredentials: true });
    sourceRef.current = es;

    es.onopen = () => setState('live');
    es.onerror = () => {
      // EventSource sets readyState to 0 (CONNECTING) during reconnect or
      // 2 (CLOSED) on permanent failure. Treat 0 as reconnect, 2 as down.
      setState(es.readyState === EventSource.CLOSED ? 'down' : 'reconnect');
    };

    const dispatch = (raw: MessageEvent): void => {
      let parsed: StreamEvent;
      try {
        parsed = JSON.parse(raw.data) as StreamEvent;
      } catch (err) {
        // Malformed payload from the server is a protocol-drift signal —
        // surface it instead of silently dropping the event.
        console.warn('StreamProvider: failed to parse SSE event', err, raw.data);
        return;
      }
      if (parsed.type === 'subscription.changed') {
        qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
        return;
      }
      if (parsed.type === 'destination.changed') {
        // The access monitor flips a destination's `accessStatus` when
        // userbot membership is gained or lost. Both the destinations
        // list and the subscription rows (which join `accessStatus` for
        // the destination indicator) must refetch.
        qc.invalidateQueries({ queryKey: DESTINATIONS_KEY });
        qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
        return;
      }
      if (FORWARD_EVENT_TYPES.has(parsed.type)) {
        setLastEvent(parsed);
      }
    };

    // Server sends named events (`event: <type>`); EventSource needs an
    // explicit listener per event name. Subscribe to all known types.
    const types = [
      'forward.started',
      'forward.completed',
      'forward.failed',
      'forward.flood_wait',
      'forward.filtered',
      'subscription.changed',
      'destination.changed',
    ] as const;
    types.forEach((t) => es.addEventListener(t, dispatch));

    return () => {
      // StrictMode mounts effects twice in dev — the first cleanup nulls out
      // sourceRef before the second one runs, so guard against the redundant
      // call to keep this idempotent.
      if (!sourceRef.current) return;
      types.forEach((t) => es.removeEventListener(t, dispatch));
      es.close();
      sourceRef.current = null;
    };
  }, [url, qc]);

  return <StreamContext.Provider value={{ state, lastEvent }}>{children}</StreamContext.Provider>;
}

export function useActivityStream(): ActivityStreamHandle {
  const ctx = useContext(StreamContext);
  if (!ctx) {
    throw new Error('useActivityStream must be used inside <StreamProvider>');
  }
  return ctx;
}
