import { useEffect, useState } from 'react';
import type { DestinationDto } from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/input';
import { DestinationOption, NoDestinationOption } from '@/components/domain/DestinationOption';

export interface DestinationPickerSheetProps {
  open: boolean;
  /** Currently attached destination id (null = detached). Seeds the selection. */
  currentDestinationId: number | null;
  destinations: DestinationDto[];
  onClose: () => void;
  onPick: (destinationId: number | null) => void;
  submitting?: boolean;
}

// Destination-only picker; the full edit (filters, etc.) lives behind the row's Edit button.
export function DestinationPickerSheet({
  open,
  currentDestinationId,
  destinations,
  onClose,
  onPick,
  submitting,
}: DestinationPickerSheetProps) {
  const [selected, setSelected] = useState<number | null>(currentDestinationId);

  useEffect(() => {
    if (open) setSelected(currentDestinationId);
  }, [open, currentDestinationId]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Forward to"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={submitting || selected === currentDestinationId}
            onClick={() => onPick(selected)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <NoDestinationOption selected={selected === null} onSelect={() => setSelected(null)} />
        {destinations.map((d) => (
          <DestinationOption
            key={d.id}
            destination={d}
            selected={selected === d.id}
            onSelect={setSelected}
          />
        ))}
        {destinations.length === 0 && (
          <Hint>No destinations yet — add one in the Destinations tab to enable forwarding.</Hint>
        )}
      </div>
    </Sheet>
  );
}
