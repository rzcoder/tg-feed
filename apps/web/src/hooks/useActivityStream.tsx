// One app-wide EventSource on `/api/stream`. Forward events go through a synchronous listener set,
// not a state slot, so same-tick events aren't coalesced and re-renders don't re-deliver old ones.
// Connection state is a separate context so layout chrome doesn't re-render per forward event.
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
      // readyState CLOSED (2) = permanent failure; CONNECTING (0) = reconnecting.
      setState(es.readyState === EventSource.CLOSED ? 'down' : 'reconnect');
    };

    const scheduleForwardLogRefresh = (): void => {
      // Throttle, not debounce: a resettable debounce would never fire on a sustained stream.
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
        // Warn in dev only; a server hiccup shouldn't flood the prod console.
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
        // Subs join the destination's `accessStatus`, so both lists must refetch.
        qc.invalidateQueries({ queryKey: DESTINATIONS_KEY });
        qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
        return;
      }
      if (FORWARD_EVENT_TYPES.has(parsed.type)) {
        listenersRef.current.forEach((listener) => listener(parsed));
        scheduleForwardLogRefresh();
      }
    };

    // Named events (`event: <type>`) need one explicit EventSource listener each.
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
      // Guard the StrictMode double-invoke: first cleanup nulls sourceRef before the second runs.
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

// Fires once synchronously per forward event. The handler ref keeps a fresh closure without resubscribing.
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
