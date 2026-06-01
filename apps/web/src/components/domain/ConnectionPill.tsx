import { cn } from '@/lib/cn';

export type ConnectionState = 'live' | 'reconnect' | 'down';

const CONFIG: Record<ConnectionState, { cls: string; dot: string; label: string }> = {
  live: {
    cls: 'text-success border-success/40 bg-success-soft',
    dot: 'bg-success pulse-dot',
    label: 'Live',
  },
  reconnect: {
    cls: 'text-warning border-warning/40 bg-warning-soft',
    dot: 'bg-warning',
    label: 'Reconnecting…',
  },
  down: {
    cls: 'text-danger border-danger/40 bg-danger-soft',
    dot: 'bg-danger',
    label: 'Disconnected',
  },
};

export interface ConnectionPillProps {
  state: ConnectionState;
  compact?: boolean;
  className?: string;
}

export function ConnectionPill({ state, compact, className }: ConnectionPillProps) {
  const cfg = CONFIG[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11.5px] font-medium border',
        cfg.cls,
        className,
      )}
      title={compact ? cfg.label : undefined}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
      {!compact && cfg.label}
    </span>
  );
}
