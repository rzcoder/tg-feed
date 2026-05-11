import { Pencil, Trash } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { EntityIcon } from '@/components/domain/EntityIcon';

export function DestRow({
  destination,
  onEdit,
  onDelete,
}: {
  destination: DestinationDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const inUse = destination.usageCount > 0;
  return (
    <div className="flex items-center gap-3 px-4.5 py-3 bg-bg border-b border-border min-h-[60px]">
      <EntityIcon iconDataUrl={destination.iconDataUrl} fallback="send" />
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[14.5px] font-medium tracking-tight truncate">
            {destination.name}
          </span>
          <span className="text-[10.5px] text-text-faint truncate">
            (Chat ID: <span className="font-mono">{destination.chatId}</span>)
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-text-muted min-w-0">
          <span>
            {destination.usageCount} sub{destination.usageCount === 1 ? '' : 's'}
          </span>
          {destination.note && (
            <>
              <span className="text-text-faint">·</span>
              <span className="text-text-faint italic truncate">({destination.note})</span>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        aria-label={`Edit ${destination.name}`}
      >
        <Pencil size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        disabled={inUse}
        title={inUse ? 'In use — reassign first' : 'Delete'}
        aria-label={`Delete ${destination.name}`}
      >
        <Trash size={14} />
      </Button>
    </div>
  );
}
