import { Check, Circle, Clock, Minus, X } from 'lucide-react';
import type { ForwardLogStatus } from '@tg-feed/shared';
import { cn } from '@/lib/cn';

type ActivityKind = ForwardLogStatus;

const CONFIG: Record<ActivityKind, { cls: string; label: string; Icon: typeof Check }> = {
  sent: { cls: 'bg-success-soft text-success', label: 'sent', Icon: Check },
  filtered: { cls: 'bg-surface-3 text-text-muted', label: 'filtered', Icon: Minus },
  flood_wait: { cls: 'bg-warning-soft text-warning', label: 'flood', Icon: Clock },
  failed: { cls: 'bg-danger-soft text-danger', label: 'failed', Icon: X },
};

export function StatusBadge({ kind }: { kind: ActivityKind }) {
  const c = CONFIG[kind] ?? { cls: '', label: kind, Icon: Circle };
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 h-5 px-1.5 rounded-md',
        'text-[10.5px] font-semibold tracking-wide uppercase tabular-nums',
        c.cls,
      )}
    >
      <c.Icon size={10} strokeWidth={2.5} />
      {c.label}
    </span>
  );
}
