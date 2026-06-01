import { useCallback } from 'react';
import { Info, Plus, Send } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { ListState } from '@/components/ui/list-state';
import { useToast } from '@/components/ui/toast';
import { Fab } from '@/components/ui/fab';
import { DestRow } from '@/components/domain/DestRow';
import { EmptyState } from '@/components/domain/EmptyState';
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
      // Edit changes name, note, and forum topic; chatId is locked in the
      // sheet and inviteHash is never set in edit mode.
      updateMut.mutate(
        {
          id: sheet.initial.id,
          body: {
            name: data.name,
            topicId: data.topicId,
            topicTitle: data.topicTitle,
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.show('Destination updated');
            sheet.close();
          },
          onError: (err) => toast.error(apiErrorMessage(err, 'Failed to update destination')),
        },
      );
    } else {
      createMut.mutate(
        {
          name: data.name,
          // Schema refines exactly one of chatId / inviteHash on the wire.
          ...(data.inviteHash ? { inviteHash: data.inviteHash } : { chatId: data.chatId! }),
          topicId: data.topicId,
          topicTitle: data.topicTitle,
          ...(data.note !== undefined ? { note: data.note } : {}),
        },
        {
          onSuccess: () => {
            toast.show('Destination added');
            sheet.close();
          },
          onError: (err) => toast.error(apiErrorMessage(err, 'Failed to add destination')),
        },
      );
    }
  };

  // Stable across renders so the memoized DestRow rows don't re-render on
  // every parent render (deleteMut/toast are themselves stable references).
  const handleDelete = useCallback(
    (d: DestinationDto) => {
      deleteMut.mutate(d.id, {
        onSuccess: () => toast.show('Destination removed'),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'destination_in_use') {
            toast.error('Destination is in use by a subscription');
            return;
          }
          toast.error(apiErrorMessage(err, 'Failed to delete destination'));
        },
      });
    },
    [deleteMut, toast],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4.5 pt-4 pb-2 text-[11.5px] text-text-muted flex items-center gap-1.5">
        <Info size={12} />
        Where matching messages get reposted. Subscriptions pick from this list.
      </div>
      <div className="scroll flex-1 min-h-0">
        <ListState
          pending={isPending}
          isEmpty={!data?.length}
          empty={
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
          }
        >
          <div className="flex flex-col border-t border-border">
            {(data ?? []).map((d) => (
              <DestRow key={d.id} destination={d} onEdit={sheet.openEdit} onDelete={handleDelete} />
            ))}
          </div>
        </ListState>
      </div>
      <Fab onClick={sheet.openAdd} label="Add destination">
        <Plus size={24} strokeWidth={2.2} />
      </Fab>
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
