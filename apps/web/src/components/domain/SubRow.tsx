import { ChevronRight, Filter, Pencil, Rss, Send, Trash } from 'lucide-react';
import type { SubscriptionDto } from '@tg-feed/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

export function SubRow({
  sub,
  expanded,
  onTap,
}: {
  sub: SubscriptionDto;
  expanded: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'w-full flex items-center gap-2.5 px-4.5 py-3 text-left bg-bg border-b border-border min-h-[60px]',
        'transition-colors',
        expanded && 'bg-bg-2 border-b-0',
      )}
    >
      <span
        className={cn(
          'grid place-items-center w-[30px] h-[30px] rounded-[7px] flex-shrink-0 transition-colors duration-100',
          expanded ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text-2 border border-border',
        )}
      >
        <Rss size={13} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[14.5px] font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
          {sub.sourceTitle}
        </div>
        <SubMeta sub={sub} />
      </div>
      <ChevronRight
        size={16}
        className={cn('text-text-faint transition-transform duration-150', expanded && 'rotate-90')}
      />
    </button>
  );
}

function SubMeta({ sub }: { sub: SubscriptionDto }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-text-muted flex-wrap">
      <span className="font-mono text-[11px]">{sub.handle ?? sub.sourceChatId.slice(-8)}</span>
      <span className="text-text-faint">·</span>
      <span className="inline-flex items-center gap-1">
        <Send size={10} />
        {sub.destinationName}
      </span>
      {sub.filterCount > 0 && (
        <>
          <span className="text-text-faint">·</span>
          <span>
            {sub.filterCount} filter{sub.filterCount === 1 ? '' : 's'}
          </span>
        </>
      )}
    </div>
  );
}

export function ExpandedSubActions({
  sub,
  onEdit,
  onViewFilters,
  onDelete,
}: {
  sub: SubscriptionDto;
  onEdit: () => void;
  onViewFilters: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-bg-2 border-b border-border px-4.5 pb-3.5">
      <div className="flex gap-2 pt-0.5 pb-3">
        <StatChip label="Source" value={sub.sourceChatId.slice(-8)} mono />
        <StatChip label="Destination" value={sub.destinationName} />
        <StatChip label="Forwarded" value={String(sub.forwardedCount)} mono />
      </div>

      <div className="flex gap-2 mt-1">
        <Button variant="secondary" size="sm" className="flex-1" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={onViewFilters}>
          <Filter size={13} /> Filters
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}

function StatChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col flex-1 min-w-0 px-2.5 py-2 bg-surface border border-border rounded-lg gap-px">
      <span className="text-[10px] font-semibold tracking-wide uppercase text-text-faint">
        {label}
      </span>
      <span
        className={cn(
          'text-[12.5px] font-medium text-text whitespace-nowrap overflow-hidden text-ellipsis',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}
