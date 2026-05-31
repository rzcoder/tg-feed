import { Filter, Info, Plus } from 'lucide-react';
import type { LibraryFilterDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { EmptyState } from '@/components/domain/EmptyState';
import { FilterRow } from '@/components/domain/FilterRow';
import { useDeleteLibraryFilter, useLibraryFilters } from '@/hooks/useFilters';
import { apiErrorMessage, ApiError } from '@/api/client';

interface LibraryViewProps {
  openAdd: () => void;
  openEdit: (f: LibraryFilterDto) => void;
}

export function LibraryView({ openAdd, openEdit }: LibraryViewProps) {
  const library = useLibraryFilters();
  const deleteMut = useDeleteLibraryFilter();
  const toast = useToast();

  return (
    <>
      <div className="flex items-center px-4.5 py-2">
        <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
          <Info size={12} />
          Reusable filters you can attach to any subscription.
        </div>
      </div>
      <div className="scroll flex-1 min-h-0 border-t border-border">
        {library.isPending ? (
          <div className="grid place-items-center py-12 text-text-muted">
            <Spinner />
          </div>
        ) : (library.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Filter size={22} />}
            title="No library filters"
            body="Save a filter here once to attach it across many subscriptions."
            cta={
              <Button variant="primary" size="sm" onClick={openAdd}>
                <Plus size={14} /> New library filter
              </Button>
            }
          />
        ) : (
          <>
            {(library.data ?? []).map((f) => (
              <FilterRow
                key={f.id}
                filter={{
                  id: f.id,
                  ruleType: f.ruleType,
                  params: f.params,
                  name: f.name,
                  enabled: true,
                  mode: f.mode,
                }}
                library
                onEdit={() => openEdit(f)}
                {...(f.usageCount === 0
                  ? {
                      onDelete: () =>
                        deleteMut.mutate(f.id, {
                          onSuccess: () => toast.show('Library filter removed'),
                          onError: (err) =>
                            toast.show(
                              err instanceof ApiError && err.code === 'library_filter_in_use'
                                ? `In use by ${f.usageCount} subscription${
                                    f.usageCount === 1 ? '' : 's'
                                  }`
                                : apiErrorMessage(err, 'Failed to delete'),
                            ),
                        }),
                    }
                  : {})}
                deleteLabel={
                  f.usageCount > 0
                    ? `In use by ${f.usageCount} sub${f.usageCount === 1 ? '' : 's'}`
                    : 'Delete'
                }
              />
            ))}
            <div className="px-4.5 py-3 text-[11px] text-text-faint">
              Library filters can't be deleted while attached. Detach first from each subscription.
            </div>
          </>
        )}
      </div>
    </>
  );
}
