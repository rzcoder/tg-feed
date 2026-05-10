import { useMemo, useState } from 'react';
import { Plus, Rss } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SubscriptionDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { ExpandedSubActions, SubRow } from '@/components/domain/SubRow';
import { EmptyState } from '@/components/domain/EmptyState';
import { SectionHeader } from '@/components/domain/SectionHeader';
import { SubSheet, type SubSheetSubmit } from '@/components/sheets/SubSheet';
import { useDestinations } from '@/hooks/useDestinations';
import { useFilterCatalog, useLibraryFilters } from '@/hooks/useFilters';
import { useSheetState } from '@/hooks/useSheetState';
import {
  useCreateSubscription,
  useDeleteSubscription,
  useSubscriptions,
  useUpdateSubscription,
} from '@/hooks/useSubscriptions';
import { apiErrorMessage } from '@/api/client';

export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const dests = useDestinations();
  const library = useLibraryFilters();
  const catalog = useFilterCatalog();
  const createMut = useCreateSubscription();
  const updateMut = useUpdateSubscription();
  const deleteMut = useDeleteSubscription();
  const availableTypes = useMemo(() => (catalog.data ?? []).map((c) => c.type), [catalog.data]);
  const toast = useToast();
  const navigate = useNavigate();

  const [openId, setOpenId] = useState<number | null>(null);
  const sheet = useSheetState<SubscriptionDto>();

  const submit = (data: SubSheetSubmit) => {
    if (sheet.mode === 'edit' && sheet.initial) {
      updateMut.mutate(
        {
          id: sheet.initial.id,
          body: {
            destinationId: data.destinationId,
            libraryFilterIds: data.libraryFilterIds,
            inlineFilters: data.inlineFilters,
          },
        },
        {
          onSuccess: () => {
            toast.show('Subscription updated');
            sheet.close();
          },
          onError: (err) => toast.show(apiErrorMessage(err, 'Failed to update')),
        },
      );
    } else {
      createMut.mutate(
        {
          // Exactly one of sourceChatId / inviteHash is set — the schema
          // refines this server-side; on the wire we send only the
          // populated half.
          ...(data.inviteHash
            ? { inviteHash: data.inviteHash }
            : { sourceChatId: data.sourceChatId! }),
          sourceTitle: data.sourceTitle,
          ...(data.handle !== null ? { handle: data.handle } : {}),
          destinationId: data.destinationId,
          libraryFilterIds: data.libraryFilterIds,
          inlineFilters: data.inlineFilters,
        },
        {
          onSuccess: () => {
            toast.show('Subscription added');
            sheet.close();
          },
          onError: (err) => toast.show(apiErrorMessage(err, 'Failed to add')),
        },
      );
    }
  };

  const onDelete = (s: SubscriptionDto) => {
    deleteMut.mutate(s.id, {
      onSuccess: () => {
        toast.show('Subscription removed');
        if (openId === s.id) setOpenId(null);
      },
      onError: (err) => toast.show(apiErrorMessage(err, 'Failed to delete')),
    });
  };

  const goToFilters = (s: SubscriptionDto) => {
    navigate(`/filters?sub=${s.id}`);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SectionHeader
        title="Subscriptions"
        count={subs.data?.length ?? 0}
        action={
          <Button variant="primary" size="sm" onClick={sheet.openAdd}>
            <Plus size={14} /> Add
          </Button>
        }
      />
      <div className="scroll flex-1 min-h-0">
        {subs.isPending ? (
          <div className="grid place-items-center py-12 text-text-muted">
            <Spinner />
          </div>
        ) : (subs.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Rss size={22} />}
            title="No subscriptions yet"
            body="Add a Telegram channel to start forwarding."
            cta={
              <Button variant="primary" size="sm" onClick={sheet.openAdd}>
                <Plus size={14} /> Add subscription
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col border-t border-border">
            {subs.data!.map((s) => (
              <div key={s.id}>
                <SubRow
                  sub={s}
                  expanded={openId === s.id}
                  onTap={() => setOpenId(openId === s.id ? null : s.id)}
                />
                {openId === s.id && (
                  <ExpandedSubActions
                    sub={s}
                    onEdit={() => sheet.openEdit(s)}
                    onViewFilters={() => goToFilters(s)}
                    onDelete={() => onDelete(s)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <SubSheet
        open={sheet.open}
        mode={sheet.mode}
        initial={sheet.initial}
        destinations={dests.data ?? []}
        library={library.data ?? []}
        availableTypes={availableTypes}
        onClose={sheet.close}
        onSubmit={submit}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}
