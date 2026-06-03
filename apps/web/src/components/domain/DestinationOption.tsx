import { memo } from 'react';
import { MessagesSquare, Slash } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { cn } from '@/lib/cn';
import { EntityIcon } from '@/components/domain/EntityIcon';

export interface DestinationOptionProps {
  destination: DestinationDto;
  selected: boolean;
  onSelect: (id: DestinationDto['id']) => void;
}

export const DestinationOption = memo(function DestinationOption({
  destination,
  selected,
  onSelect,
}: DestinationOptionProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(destination.id)}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        selected
          ? 'bg-accent-soft border border-accent'
          : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded-full border-[1.5px] grid place-items-center flex-shrink-0',
          selected ? 'border-accent bg-accent' : 'border-border-strong',
        )}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-accent-fg" />}
      </span>
      <EntityIcon iconDataUrl={destination.iconDataUrl} fallback="send" size="sm" />
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight truncate">{destination.name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted min-w-0">
          {destination.topicTitle && (
            <span className="inline-flex items-center gap-1 min-w-0 text-text-muted">
              <MessagesSquare size={10} className="flex-shrink-0" />
              <span className="truncate">{destination.topicTitle}</span>
            </span>
          )}
          <span className="font-mono truncate flex-shrink-0">({destination.chatId})</span>
          {destination.note && (
            <span className="font-sans italic text-text-faint truncate">({destination.note})</span>
          )}
        </div>
      </div>
    </button>
  );
});

export interface NoDestinationOptionProps {
  selected: boolean;
  onSelect: () => void;
}

export function NoDestinationOption({ selected, onSelect }: NoDestinationOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        selected
          ? 'bg-warning-soft border border-warning/40'
          : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded-full border-[1.5px] grid place-items-center flex-shrink-0',
          selected ? 'border-warning bg-warning' : 'border-border-strong',
        )}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-warning-fg" />}
      </span>
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-bg text-text-faint border border-border flex-shrink-0">
        <Slash size={14} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">No destination</div>
        <div className="text-[11px] text-text-muted">Subscription saved but won't forward.</div>
      </div>
    </button>
  );
}
