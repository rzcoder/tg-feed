/**
 * Activity feed — hydrate from forward-log, prepend live SSE events.
 *
 * Hydration: `useForwardLog({ limit: 50 })` seeds the in-memory list and is
 * refreshed (debounced) as forward events arrive, so the persisted history
 * stays current. Live SSE events arrive via `useForwardEvents` and get
 * prepended immediately (capped at 200 entries to bound memory), then
 * reconcile with the refreshed log by `forwardLogId`.
 *
 * Enrichment: hydrated rows already have `subscriptionTitle`, `sourceHandle`,
 * and `destinationName` joined server-side via LEFT JOIN. SSE payloads carry
 * IDs only, so they're enriched on the client from the cached
 * `useSubscriptions` and `useDestinations` queries — with a backfill effect
 * for the case where a live event arrives before those queries hydrate.
 *
 * Pause: stops appending new events to the list (the EventSource stays
 * open). Scroll lock + jump-to-live: when the user has scrolled away from
 * the top, prepends don't yank — show a button to jump back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, Activity as ActivityIcon, Pause, Play } from 'lucide-react';
import type {
  DestinationDto,
  ForwardLogEntryDto,
  ForwardLogStatus,
  StreamEvent,
  SubscriptionDto,
} from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ConnectionPill } from '@/components/domain/ConnectionPill';
import { ActivityRow, type ActivityEvent } from '@/components/domain/ActivityRow';
import { EmptyState } from '@/components/domain/EmptyState';
import { JsonViewSheet } from '@/components/domain/JsonViewSheet';
import { useConnectionState, useForwardEvents } from '@/hooks/useActivityStream';
import { useDestinations } from '@/hooks/useDestinations';
import { useForwardLog } from '@/hooks/useForwardLog';
import { useSubscriptions } from '@/hooks/useSubscriptions';

const MAX_EVENTS = 200;

export function ActivityPage() {
  const subs = useSubscriptions();
  const dests = useDestinations();
  const forwardLog = useForwardLog({ limit: 50 });

  const [paused, setPaused] = useState(false);
  const connectionState = useConnectionState();

  const subById = useMemo(() => buildSubMap(subs.data ?? []), [subs.data]);
  const destByChatId = useMemo(() => buildDestMap(dests.data ?? []), [dests.data]);

  const [events, setEvents] = useState<ActivityEvent[]>([]);

  // Hydrate from forward-log, and re-hydrate when it refetches (the stream
  // provider refreshes it as forward events land). Keep live events the
  // fetched log doesn't contain yet; drop those it does — matched by the
  // forward_log row id the event carried — so a row isn't shown twice.
  useEffect(() => {
    if (!forwardLog.data) return;
    // While paused the feed is frozen — skip re-hydration so a background
    // log refetch doesn't prepend rows; `paused` is a dep, so it catches up
    // on resume.
    if (paused) return;
    setEvents((prev) => {
      const hydrated = forwardLog.data.items.map((row) => fromForwardLogEntry(row));
      const persistedIds = new Set(forwardLog.data.items.map((row) => row.id));
      const live = prev.filter(
        (e) =>
          e.id.startsWith('live:') && (e.forwardLogId == null || !persistedIds.has(e.forwardLogId)),
      );
      return [...live, ...hydrated].slice(0, MAX_EVENTS);
    });
  }, [forwardLog.data, paused]);

  // Read sub/dest maps via refs inside the prepend effect — including them
  // in the dep array would re-run the effect (and re-prepend the same SSE
  // event) every time `subscription.changed` invalidates the queries and
  // produces a new Map reference. Backfill enrichment is handled by the
  // separate effect below.
  const subByIdRef = useRef(subById);
  const destByChatIdRef = useRef(destByChatId);
  useEffect(() => {
    subByIdRef.current = subById;
    destByChatIdRef.current = destByChatId;
  });

  // Pause is read through a ref so the event handler stays stable (subscribes
  // once) and isn't re-created when `paused` toggles.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Prepend live SSE events as they arrive, deduped against the head in case
  // the server ever re-emits one.
  const handleForwardEvent = useCallback((event: StreamEvent) => {
    if (pausedRef.current) return;
    const built = fromStreamEvent(event, subByIdRef.current, destByChatIdRef.current);
    if (!built) return;
    setEvents((prev) =>
      prev.some((e) => e.id === built.id) ? prev : [built, ...prev].slice(0, MAX_EVENTS),
    );
  }, []);
  useForwardEvents(handleForwardEvent);

  // Backfill events constructed before subs/dests loaded. Returns the same
  // array reference when nothing needs enrichment, so ActivityRow rows keep
  // referential equality and don't re-render.
  useEffect(() => {
    setEvents((prev) => {
      const needsEnrich = prev.some(
        (e) =>
          e.subscriptionId !== null &&
          (e.subscriptionTitle === null || e.sourceHandle === null || e.destinationLabel === null),
      );
      if (!needsEnrich) return prev;
      return prev.map((e) => enrichEvent(e, subById));
    });
  }, [subById]);

  const [jsonViewerId, setJsonViewerId] = useState<number | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLocked(e.currentTarget.scrollTop > 30);
  };

  // Auto-scroll to top on prepend unless the user has scrolled away.
  useEffect(() => {
    if (scrollLocked) return;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [events.length, scrollLocked]);

  const displayConnectionState = paused ? 'down' : connectionState;
  const isLoading = forwardLog.isPending;
  const isError = forwardLog.isError;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      <div className="flex items-center justify-end gap-2.5 px-4.5 py-3 border-b border-border bg-bg">
        <div className="flex items-center gap-2">
          <ConnectionPill state={displayConnectionState} />
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume stream' : 'Pause stream'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </Button>
        </div>
      </div>

      <div ref={scrollerRef} className="scroll flex-1 min-h-0 relative" onScroll={onScroll}>
        {isLoading ? (
          <div className="grid place-items-center py-12 text-text-muted">
            <Spinner />
          </div>
        ) : isError ? (
          <EmptyState
            icon={<AlertTriangle size={22} className="text-danger" />}
            title="Failed to load activity"
            body="Could not fetch the forward log. Check your connection and try again."
            cta={
              <Button variant="secondary" size="sm" onClick={() => forwardLog.refetch()}>
                Retry
              </Button>
            }
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={
              <ActivityIcon
                size={22}
                className="animate-spin"
                style={{ animationDuration: '2.4s' }}
              />
            }
            title="Waiting for activity…"
            body={
              paused
                ? 'Stream is paused. Resume to receive new events.'
                : "When events arrive, they'll show up here."
            }
          />
        ) : (
          events.map((e) => <ActivityRow key={e.id} event={e} onViewJson={setJsonViewerId} />)
        )}
      </div>

      <JsonViewSheet
        open={jsonViewerId != null}
        forwardLogId={jsonViewerId}
        onOpenChange={(open) => {
          if (!open) setJsonViewerId(null);
        }}
      />

      {scrollLocked && events.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
          }}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-fg text-[12px] font-semibold shadow"
        >
          <ArrowDown size={13} strokeWidth={2.5} /> Jump to live
        </button>
      )}
    </div>
  );
}

function buildSubMap(subs: SubscriptionDto[]): Map<number, SubscriptionDto> {
  return new Map(subs.map((s) => [s.id, s]));
}

function buildDestMap(dests: DestinationDto[]): Map<string, DestinationDto> {
  return new Map(dests.map((d) => [d.chatId, d]));
}

function enrichEvent(event: ActivityEvent, subs: Map<number, SubscriptionDto>): ActivityEvent {
  if (event.subscriptionId === null) return event;
  const sub = subs.get(event.subscriptionId);
  if (!sub) return event;
  const subscriptionTitle = event.subscriptionTitle ?? sub.sourceTitle;
  const sourceHandle = event.sourceHandle ?? sub.handle ?? sub.sourceChatId;
  const destinationLabel = event.destinationLabel ?? sub.destinationName;
  if (
    subscriptionTitle === event.subscriptionTitle &&
    sourceHandle === event.sourceHandle &&
    destinationLabel === event.destinationLabel
  ) {
    return event;
  }
  return { ...event, subscriptionTitle, sourceHandle, destinationLabel };
}

function fromForwardLogEntry(row: ForwardLogEntryDto): ActivityEvent {
  // Build optional fields conditionally — under exactOptionalPropertyTypes,
  // `{ seconds: undefined }` no longer satisfies `seconds?: number`.
  const floodWaitSeconds =
    row.status === 'flood_wait' ? parseFloodWaitSeconds(row.error) : undefined;
  return {
    id: `db:${row.id}`,
    kind: row.status,
    subscriptionId: row.subscriptionId,
    subscriptionTitle: row.subscriptionTitle,
    sourceHandle: row.sourceHandle,
    destinationLabel: row.destinationName,
    occurredAt: new Date(row.createdAt).getTime(),
    forwardLogId: row.id,
    hasRawMessage: row.hasRawMessage,
    ...(row.status === 'filtered' && row.error ? { reasons: row.error.split('; ') } : {}),
    ...(row.status === 'failed' ? { error: row.error } : {}),
    ...(floodWaitSeconds !== undefined ? { seconds: floodWaitSeconds } : {}),
  };
}

function parseFloodWaitSeconds(error: string | null): number | undefined {
  if (!error) return undefined;
  const m = error.match(/flood_wait (\d+)s/);
  return m ? Number(m[1]) : undefined;
}

function fromStreamEvent(
  event: StreamEvent,
  subs: Map<number, SubscriptionDto>,
  dests: Map<string, DestinationDto>,
): ActivityEvent | null {
  const occurredAt = new Date(event.occurredAt).getTime();
  // `destination.changed` events don't carry a subscription id — the
  // narrowed switch below filters them out, but the lookup needs a guard
  // for the type checker.
  const subscriptionId = 'subscriptionId' in event ? event.subscriptionId : undefined;
  const sub = subscriptionId !== undefined ? subs.get(subscriptionId) : undefined;
  const subscriptionTitle = sub?.sourceTitle ?? null;
  const sourceHandle = sub?.handle ?? sub?.sourceChatId ?? null;
  const sourceMessageId = 'sourceMessageIds' in event ? (event.sourceMessageIds[0] ?? '?') : '?';

  // The `forward.*` SSE variants now carry the inserted `forward_log`
  // row ids so we can offer "view raw" on live entries without waiting
  // for the next hydration. Index 0 is enough — the JSON viewer reads
  // the same denormalised payload from any row of an album.
  const forwardLogId = 'forwardLogIds' in event ? (event.forwardLogIds[0] ?? undefined) : undefined;
  const hasRawMessage = forwardLogId != null;
  switch (event.type) {
    case 'forward.completed': {
      const destLabel = dests.get(event.destinationChatId)?.name ?? event.destinationChatId;
      const id = `live:${event.subscriptionId}:${sourceMessageId}:completed`;
      return {
        id,
        kind: 'sent' satisfies ForwardLogStatus,
        subscriptionId: event.subscriptionId,
        subscriptionTitle,
        sourceHandle,
        destinationLabel: destLabel,
        occurredAt,
        destMessageCount: event.destMessageIds.length,
        isNew: true,
        ...(forwardLogId !== undefined ? { forwardLogId } : {}),
        hasRawMessage,
      };
    }
    case 'forward.failed': {
      const destLabel = dests.get(event.destinationChatId)?.name ?? event.destinationChatId;
      return {
        id: `live:${event.subscriptionId}:${sourceMessageId}:failed`,
        kind: 'failed',
        subscriptionId: event.subscriptionId,
        subscriptionTitle,
        sourceHandle,
        destinationLabel: destLabel,
        occurredAt,
        error: event.error,
        isNew: true,
        ...(forwardLogId !== undefined ? { forwardLogId } : {}),
        hasRawMessage,
      };
    }
    case 'forward.flood_wait': {
      const destLabel = dests.get(event.destinationChatId)?.name ?? event.destinationChatId;
      return {
        id: `live:${event.subscriptionId}:${sourceMessageId}:flood`,
        kind: 'flood_wait',
        subscriptionId: event.subscriptionId,
        subscriptionTitle,
        sourceHandle,
        destinationLabel: destLabel,
        occurredAt,
        seconds: event.seconds,
        isNew: true,
        ...(forwardLogId !== undefined ? { forwardLogId } : {}),
        hasRawMessage,
      };
    }
    case 'forward.filtered': {
      // forward.filtered doesn't carry destinationChatId — look it up from
      // subscription instead. `destinationChatId` may be null when the
      // subscription has been detached.
      const destLabel =
        sub && sub.destinationChatId && dests.get(sub.destinationChatId)?.name
          ? dests.get(sub.destinationChatId)!.name
          : (sub?.destinationName ?? null);
      return {
        id: `live:${event.subscriptionId}:${sourceMessageId}:filtered`,
        kind: 'filtered',
        subscriptionId: event.subscriptionId,
        subscriptionTitle,
        sourceHandle,
        destinationLabel: destLabel,
        occurredAt,
        reasons: event.reasons,
        isNew: true,
        ...(forwardLogId !== undefined ? { forwardLogId } : {}),
        hasRawMessage,
      };
    }
    default:
      return null;
  }
}
