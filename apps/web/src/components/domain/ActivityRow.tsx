import { memo, useState } from 'react';
import { AlertTriangle, ArrowRight, Braces } from 'lucide-react';
import type { ForwardLogStatus } from '@tg-feed/shared';
import { cn } from '@/lib/cn';
import { formatAbsoluteTime, formatRelative } from '@/lib/formatRelative';
import { useNowTick } from '@/lib/useNowTick';
import { StatusBadge } from './StatusBadge';

export interface ActivityEvent {
  // `db:<id>` or live composite `live:<sub>:<msg>:<type>`.
  id: string;
  kind: ForwardLogStatus;
  subscriptionId: number | null;
  subscriptionTitle: string | null;
  sourceHandle: string | null;
  destinationLabel: string | null;
  occurredAt: number; // ms epoch
  reasons?: string[];
  seconds?: number;
  error?: string | null;
  destMessageCount?: number; // >1 = album
  isNew?: boolean;
  forwardLogId?: number;
  // Live events default true: capture precedes the SSE emit.
  hasRawMessage?: boolean;
}

interface ActivityRowProps {
  event: ActivityEvent;
  onViewJson?: (forwardLogId: number) => void;
}

export const ActivityRow = memo(function ActivityRow({ event, onViewJson }: ActivityRowProps) {
  const canViewJson =
    event.hasRawMessage === true && event.forwardLogId != null && onViewJson != null;

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-4.5 py-3 border-b border-border bg-bg',
        event.isNew && 'animate-flash-in',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusBadge kind={event.kind} />
          <span className="text-[12.5px] font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis flex-1">
            {event.subscriptionTitle ?? `sub #${event.subscriptionId ?? '?'}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {canViewJson && (
            <button
              type="button"
              aria-label="View raw message JSON"
              title="View raw message JSON"
              onClick={() => onViewJson(event.forwardLogId!)}
              className="text-text-muted hover:text-text transition-colors"
            >
              <Braces size={13} strokeWidth={2} />
            </button>
          )}
          <RelativeTime occurredAt={event.occurredAt} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="font-mono">{event.sourceHandle ?? '—'}</span>
        <ArrowRight size={11} strokeWidth={2} className="text-text-faint" />
        <span className="font-mono">{event.destinationLabel ?? '—'}</span>
        {event.kind === 'sent' && (event.destMessageCount ?? 0) > 1 && (
          <>
            <span className="text-text-faint">·</span>
            <span>forwarded {event.destMessageCount} messages</span>
          </>
        )}
      </div>
      {event.kind === 'filtered' && event.reasons && event.reasons.length > 0 && (
        <ReasonChips reasons={event.reasons} />
      )}
      {event.kind === 'flood_wait' && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-warning">
          <AlertTriangle size={12} strokeWidth={2.2} />
          <span className="font-mono">FloodWait {event.seconds ?? 0}s</span>
          {event.seconds !== undefined && (
            <span className="text-text-muted">— retry in {event.seconds}s</span>
          )}
        </div>
      )}
      {event.kind === 'failed' && event.error && (
        <div className="px-2 py-1.5 bg-danger-soft border border-danger/30 rounded-md font-mono text-[11px] text-danger">
          {event.error}
        </div>
      )}
    </div>
  );
});

interface RelativeTimeProps {
  occurredAt: number;
}

function RelativeTime({ occurredAt }: RelativeTimeProps) {
  const now = useNowTick();
  const ageSec = Math.max(0, (now - occurredAt) / 1000);
  const [hover, setHover] = useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-[11.5px] text-text-muted tabular-nums"
    >
      {hover ? formatAbsoluteTime(ageSec) : formatRelative(ageSec)}
    </span>
  );
}

interface ParsedReason {
  library: string | null;
  text: string;
}

function parseReason(reason: string): ParsedReason {
  if (reason.startsWith('library:')) {
    const rest = reason.slice('library:'.length);
    const colon = rest.indexOf(': ');
    if (colon > 0) {
      return { library: rest.slice(0, colon), text: rest.slice(colon + 2) };
    }
  }
  return { library: null, text: reason };
}

interface ReasonChipsProps {
  reasons: string[];
}

function ReasonChips({ reasons }: ReasonChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r, i) => {
        const parsed = parseReason(r);
        return (
          <span
            key={`${i}-${r}`}
            className={cn(
              'inline-flex items-center gap-1 font-mono text-[10.5px] px-1.5 py-px rounded',
              'bg-surface-2 border border-border text-text-muted',
            )}
          >
            {parsed.library && (
              <span className="bg-accent-soft text-accent border border-accent/30 px-1 rounded text-[9.5px] uppercase tracking-wide">
                {parsed.library}
              </span>
            )}
            {parsed.text}
          </span>
        );
      })}
    </div>
  );
}
