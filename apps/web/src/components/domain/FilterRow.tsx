import { Hash, Pencil, Trash, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  describeFilter,
  FILTER_RULE_ICONS,
  FILTER_RULE_LABELS,
  type FilterLike,
} from '@/lib/describeFilter';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/settings/primitives';

export interface FilterRowProps {
  filter: FilterLike & { id: number; enabled?: boolean; name?: string | null };
  library?: boolean;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  // Delete-button label override, e.g. "Detach".
  deleteLabel?: string;
}

export function FilterRow({
  filter,
  library,
  onToggle,
  onEdit,
  onDelete,
  deleteLabel,
}: FilterRowProps) {
  const Icon = FILTER_RULE_ICONS[filter.ruleType] ?? Hash;
  const enabled = filter.enabled !== false;
  const isExclude = filter.mode === 'exclude';
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg min-h-[60px]',
        !enabled && 'opacity-55',
      )}
    >
      <span
        className={cn(
          'grid place-items-center w-8 h-8 rounded-lg flex-shrink-0',
          library
            ? 'bg-accent-soft text-accent border border-accent/30'
            : 'bg-surface-2 text-text-2',
        )}
      >
        <Icon size={15} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-medium tracking-tight">
            {filter.name ?? FILTER_RULE_LABELS[filter.ruleType]}
          </span>
          {library && (
            <span className="text-[9.5px] font-semibold tracking-wide uppercase px-1.5 py-px rounded-sm bg-accent-soft text-accent">
              Library
            </span>
          )}
          {isExclude && (
            <span className="text-[9.5px] font-semibold tracking-wide uppercase px-1.5 py-px rounded-sm bg-warning-soft text-warning border border-warning/30">
              Exclude
            </span>
          )}
        </div>
        <div className="font-mono text-[11.5px] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
          {describeFilter(filter)}
        </div>
      </div>
      {onToggle && <Toggle checked={enabled} onChange={onToggle} />}
      {onEdit && (
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit filter">
          <Pencil size={14} />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          title={deleteLabel ?? 'Delete'}
          aria-label={deleteLabel ?? 'Delete filter'}
        >
          {library ? <X size={15} strokeWidth={2} /> : <Trash size={14} />}
        </Button>
      )}
    </div>
  );
}
