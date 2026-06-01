/**
 * SSE stream singleton.
 *
 * `StreamProvider` opens one EventSource on `/api/stream` for the whole app
 * (mounted in AppShell). All consumers — sidebar/top-bar connection pill,
 * activity page event feed — read from the same source.
 *
 * Forward events are delivered through a subscription (`useForwardEvents`)
 * rather than a "last event" state value: a state slot collapses two events
 * that arrive in the same tick into one (React batches the setter), and any
 * consumer effect keyed on it re-runs — and re-delivers the same event — on
 * unrelated re-renders. A synchronous listener set delivers every event
 * exactly once. Connection state stays a separate context so the layout
 * chrome doesn't re-render on every forward event.
 *
 * EventSource auto-reconnects with browser-controlled backoff. We surface
 * readyState transitions as `'reconnect'` while connecting and `'live'`
 * once OPEN. `subscription.changed`/`destination.changed` events invalidate
 * the relevant queries directly; forward events also schedule a debounced
 * refresh of the forward-log so the persisted history reconciles with the
 * live overlay (otherwise a remount would drop events that only ever lived
 * in component state).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StreamEvent } from '@tg-feed/shared';
import { DESTINATIONS_KEY } from './useDestinations';
import { FORWARD_LOG_KEY } from './useForwardLog';
import { SUBSCRIPTIONS_KEY } from './useSubscriptions';

export type ConnectionState = 'live' | 'reconnect' | 'down';
export type ForwardEventListener = (event: StreamEvent) => void;

const FORWARD_EVENT_TYPES = new Set([
  'forward.completed',
  'forward.failed',
  'forward.flood_wait',
  'forward.filtered',
]);

// Coalesce bursts of forward events into a single forward-log refetch.
const FORWARD_LOG_REFRESH_MS = 3000;

const ConnectionStateContext = createContext<ConnectionState | null>(null);
const ForwardEventsContext = createContext<((listener: ForwardEventListener) => () => void) | null>(
  null,
);

export interface StreamProviderProps {
  children: ReactNode;
  url?: string;
}

export function StreamProvider({ children, url = '/api/stream' }: StreamProviderProps) {
  const [state, setState] = useState<ConnectionState>('reconnect');
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Set<ForwardEventListener>>(new Set());

  const subscribe = useCallback((listener: ForwardEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource(url, { withCredentials: true });
    sourceRef.current = es;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    es.onopen = () => setState('live');
    es.onerror = () => {
      // EventSource sets readyState to 0 (CONNECTING) during reconnect or
      // 2 (CLOSED) on permanent failure. Treat 0 as reconnect, 2 as down.
      setState(es.readyState === EventSource.CLOSED ? 'down' : 'reconnect');
    };

    const scheduleForwardLogRefresh = (): void => {
      // Throttle, not debounce: a resettable debounce would never fire on a
      // sustained stream (each event re-arms it). Arm once and let it run, so
      // the log refreshes at most once per window but is guaranteed to.
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        qc.invalidateQueries({ queryKey: FORWARD_LOG_KEY });
      }, FORWARD_LOG_REFRESH_MS);
    };

    const dispatch = (raw: MessageEvent): void => {
      let parsed: StreamEvent;
      try {
        parsed = JSON.parse(raw.data) as StreamEvent;
      } catch (err) {
        // Malformed payload signals protocol drift between server and client.
        // Surface it in dev; stay quiet in prod so a server hiccup can't flood
        // the user's console.
        if (import.meta.env.DEV) {
          console.warn('StreamProvider: failed to parse SSE event', err, raw.data);
        }
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
        listenersRef.current.forEach((listener) => listener(parsed));
        scheduleForwardLogRefresh();
      }
    };

    // Server sends named events (`event: <type>`); EventSource needs an
    // explicit listener per event name. Subscribe to all known types.
    const types = [
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
      if (refreshTimer) clearTimeout(refreshTimer);
      types.forEach((t) => es.removeEventListener(t, dispatch));
      es.close();
      sourceRef.current = null;
    };
  }, [url, qc]);

  return (
    <ConnectionStateContext.Provider value={state}>
      <ForwardEventsContext.Provider value={subscribe}>{children}</ForwardEventsContext.Provider>
    </ConnectionStateContext.Provider>
  );
}

export function useConnectionState(): ConnectionState {
  const ctx = useContext(ConnectionStateContext);
  if (ctx === null) {
    throw new Error('useConnectionState must be used inside <StreamProvider>');
  }
  return ctx;
}

/**
 * Subscribe to live forward events. The listener fires once per event,
 * synchronously as it arrives — so no event is dropped between renders and
 * unrelated re-renders never re-deliver an old one. Pass a stable callback
 * (e.g. `useCallback`) that reads any changing values through refs.
 */
export function useForwardEvents(onEvent: ForwardEventListener): void {
  const subscribe = useContext(ForwardEventsContext);
  if (!subscribe) {
    throw new Error('useForwardEvents must be used inside <StreamProvider>');
  }
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });
  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe]);
}
