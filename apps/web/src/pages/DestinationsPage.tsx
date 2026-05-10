import { Info, Plus, Send } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { DestRow } from '@/components/domain/DestRow';
import { EmptyState } from '@/components/domain/EmptyState';
import { SectionHeader } from '@/components/domain/SectionHeader';
import { DestSheet, type DestSheetSubmit } from '@/components/sheets/DestSheet';
import {
  useCreateDestination,
  useDeleteDestination,
  useDestinations,
  useUpdateDestination,
} from '@/hooks/useDestinations';
import { useSheetState } from '@/hooks/useSheetState';
import { apiErrorMessage, ApiError } from '@/api/client';

export function DestinationsPage() {
  const { data, isPending } = useDestinations();
  const createMut = useCreateDestination();
  const updateMut = useUpdateDestination();
  const deleteMut = useDeleteDestination();
  const toast = useToast();

  const sheet = useSheetState<DestinationDto>();

  const submit = (data: DestSheetSubmit) => {
    if (sheet.mode === 'edit' && sheet.initial) {
      // Edit only changes name + note today; chatId is locked in the sheet
      // and inviteHash is never set in edit mode.
      updateMut.mutate(
        {
          id: sheet.initial.id,
          body: {
            name: data.name,
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.show('Destination updated');
            sheet.close();
          },
          onError: (err) => toast.show(apiErrorMessage(err, 'Failed to update destination')),
        },
      );
    } else {
      createMut.mutate(
        {
          name: data.name,
          // Schema refines exactly one of chatId / inviteHash on the wire.
          ...(data.inviteHash ? { inviteHash: data.inviteHash } : { chatId: data.chatId! }),
          ...(data.note !== undefined ? { note: data.note } : {}),
        },
        {
          onSuccess: () => {
            toast.show('Destination added');
            sheet.close();
          },
          onError: (err) => toast.show(apiErrorMessage(err, 'Failed to add destination')),
        },
      );
    }
  };

  const onDelete = (d: DestinationDto) => {
    deleteMut.mutate(d.id, {
      onSuccess: () => toast.show('Destination removed'),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'destination_in_use') {
          toast.show('Destination is in use by a subscription');
          return;
        }
        toast.show(apiErrorMessage(err, 'Failed to delete destination'));
      },
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SectionHeader
        title="Destinations"
        count={data?.length ?? 0}
        action={
          <Button variant="primary" size="sm" onClick={sheet.openAdd}>
            <Plus size={14} /> Add
          </Button>
        }
      />
      <div className="px-4.5 pb-2 text-[11.5px] text-text-muted flex items-center gap-1.5">
        <Info size={12} />
        Where matching messages get reposted. Subscriptions pick from this list.
      </div>
      <div className="scroll flex-1 min-h-0">
        {isPending ? (
          <div className="grid place-items-center py-12 text-text-muted">
            <Spinner />
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Send size={22} />}
            title="No destinations yet"
            body="Add a Telegram chat id to start forwarding into."
            cta={
              <Button variant="primary" size="sm" onClick={sheet.openAdd}>
                <Plus size={14} /> Add destination
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col border-t border-border">
            {data!.map((d) => (
              <DestRow
                key={d.id}
                destination={d}
                onEdit={() => sheet.openEdit(d)}
                onDelete={() => onDelete(d)}
              />
            ))}
          </div>
        )}
      </div>
      <DestSheet
        open={sheet.open}
        mode={sheet.mode}
        initial={sheet.initial}
        onClose={sheet.close}
        onSubmit={submit}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}
