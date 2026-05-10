import { Pencil, Send, Trash } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';

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
      <span className="grid place-items-center w-[30px] h-[30px] rounded-[7px] bg-surface-2 border border-border text-text-2 flex-shrink-0">
        <Send size={13} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="text-[14.5px] font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
          {destination.name}
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-text-muted">
          <span className="font-mono text-[11px]">{destination.chatId}</span>
          <span className="text-text-faint">·</span>
          <span>
            {destination.usageCount} sub{destination.usageCount === 1 ? '' : 's'}
          </span>
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
