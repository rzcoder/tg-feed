import type { FilterRuleType } from '@tg-feed/shared';
import { useToast } from '@/components/ui/toast';
import { FilterSheet, type FilterSheetSubmit } from '@/components/sheets/FilterSheet';
import {
  useCreateLibraryFilter,
  useCreateSubscriptionFilter,
  useUpdateLibraryFilter,
  useUpdateSubscriptionFilter,
} from '@/hooks/useFilters';
import type { FilterSheetState } from '@/hooks/useFilterSheetState';

interface FilterSheetControllerProps {
  sheet: FilterSheetState;
  onClose: () => void;
  availableTypes: readonly FilterRuleType[];
  subscriptionId: number | null;
}

export function FilterSheetController({
  sheet,
  onClose,
  availableTypes,
  subscriptionId,
}: FilterSheetControllerProps) {
  const createSubMut = useCreateSubscriptionFilter();
  const updateSubMut = useUpdateSubscriptionFilter();
  const createLibMut = useCreateLibraryFilter();
  const updateLibMut = useUpdateLibraryFilter();
  const toast = useToast();

  const handleSubmit = (data: FilterSheetSubmit) => {
    if (sheet.kind === 'library') {
      if (sheet.mode === 'edit' && sheet.initial) {
        updateLibMut.mutate(
          {
            id: sheet.initial.id,
            body: { name: data.name ?? '', params: data.params, mode: data.mode },
          },
          {
            onSuccess: () => {
              toast.show('Library filter updated');
              onClose();
            },
            onError: () => toast.show('Failed to update'),
          },
        );
      } else {
        createLibMut.mutate(
          // The discriminated-union schema is satisfied at runtime because the
          // server zod validates the same shape; we cast through the same wire
          // shape here.
          {
            name: data.name ?? '',
            ruleType: data.ruleType,
            params: data.params,
            mode: data.mode,
          } as Parameters<typeof createLibMut.mutate>[0],
          {
            onSuccess: () => {
              toast.show('Library filter added');
              onClose();
            },
            onError: () => toast.show('Failed to add'),
          },
        );
      }
    } else {
      if (subscriptionId === null) return;
      if (sheet.mode === 'edit' && sheet.initial) {
        updateSubMut.mutate(
          {
            subscriptionId,
            filterId: sheet.initial.id,
            body: { params: data.params, mode: data.mode },
          },
          {
            onSuccess: () => {
              toast.show('Filter updated');
              onClose();
            },
            onError: () => toast.show('Failed to update'),
          },
        );
      } else {
        createSubMut.mutate(
          {
            subscriptionId,
            body: {
              ruleType: data.ruleType,
              params: data.params,
              mode: data.mode,
            } as Parameters<typeof createSubMut.mutate>[0]['body'],
          },
          {
            onSuccess: () => {
              toast.show('Filter added');
              onClose();
            },
            onError: () => toast.show('Failed to add'),
          },
        );
      }
    }
  };

  return (
    <FilterSheet
      open={sheet.open}
      mode={sheet.mode}
      kind={sheet.kind}
      initial={sheet.initial}
      availableTypes={availableTypes}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={
        createSubMut.isPending ||
        updateSubMut.isPending ||
        createLibMut.isPending ||
        updateLibMut.isPending
      }
    />
  );
}
