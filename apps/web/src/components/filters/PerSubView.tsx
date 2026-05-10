import { Filter, Info, Plus, Rss } from 'lucide-react';
import type { FilterRuleType, LibraryFilterDto, SubscriptionFilterDto } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { EmptyState } from '@/components/domain/EmptyState';
import { FilterRow } from '@/components/domain/FilterRow';
import {
  useDeleteSubscriptionFilter,
  useDetachLibraryFilter,
  useSubscriptionFilters,
  useUpdateSubscriptionFilter,
} from '@/hooks/useFilters';
import type { useSubscriptions } from '@/hooks/useSubscriptions';

type SubsList = NonNullable<ReturnType<typeof useSubscriptions>['data']>;

interface PerSubViewProps {
  activeSubId: number | null;
  setSubId: (next: number | null) => void;
  /** Currently unused — wired in for future filter-type gating. */
  availableTypes: readonly FilterRuleType[];
  openAddFilter: () => void;
  openEditFilter: (f: SubscriptionFilterDto) => void;
  subsLoading: boolean;
  subs: SubsList;
  librarySource: LibraryFilterDto[];
}

export function PerSubView({
  activeSubId,
  setSubId,
  availableTypes: _availableTypes,
  openAddFilter,
  openEditFilter,
  subsLoading,
  subs,
  librarySource,
}: PerSubViewProps) {
  const sub = subs.find((s) => s.id === activeSubId) ?? subs[0];
  const filtersQuery = useSubscriptionFilters(sub?.id ?? null);
  const updateMut = useUpdateSubscriptionFilter();
  const deleteMut = useDeleteSubscriptionFilter();
  const detachLibMut = useDetachLibraryFilter();
  const toast = useToast();

  if (subsLoading) {
    return (
      <div className="grid place-items-center py-12 text-text-muted">
        <Spinner />
      </div>
    );
  }
  if (!sub) {
    return (
      <EmptyState
        icon={<Filter size={22} />}
        title="No subscription"
        body="Add a subscription first to attach filters."
      />
    );
  }

  const own = filtersQuery.data ?? [];
  const attachedLibrary = (sub.libraryFilterIds ?? [])
    .map((id) => librarySource.find((l) => l.id === id))
    .filter((l): l is LibraryFilterDto => Boolean(l));
  const total = own.length + attachedLibrary.length;

  return (
    <>
      <div className="px-4.5 pb-2">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface border border-border rounded-[10px]">
          <span className="grid place-items-center w-7 h-7 rounded-[7px] bg-accent-soft text-accent border border-accent/30 flex-shrink-0">
            <Rss size={14} />
          </span>
          <div className="flex flex-col flex-1 min-w-0 gap-px">
            <div className="text-[13.5px] font-medium tracking-tight">{sub.sourceTitle}</div>
            <div className="font-mono text-[11px] text-text-muted">
              {sub.handle ?? sub.sourceChatId}
            </div>
          </div>
          <select
            value={sub.id}
            onChange={(e) => setSubId(Number(e.target.value))}
            className="h-7 px-2 rounded-md bg-surface-2 border border-border text-[12px] text-text-2"
          >
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sourceTitle}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-4.5 py-2">
        <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
          <Info size={12} />
          {total === 0
            ? 'Without filters, every message forwards.'
            : 'All enabled filters must match (AND).'}
        </div>
        <Button variant="primary" size="sm" onClick={openAddFilter}>
          <Plus size={14} /> Add
        </Button>
      </div>

      <div className="scroll flex-1 min-h-0 border-t border-border">
        {filtersQuery.isPending ? (
          <div className="grid place-items-center py-8 text-text-muted">
            <Spinner />
          </div>
        ) : total === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-text-muted">
            No filters yet — add a custom one above, or attach a library filter from the Library
            tab.
          </div>
        ) : (
          <>
            {attachedLibrary.map((f) => (
              <FilterRow
                key={`lib-${f.id}`}
                filter={{
                  id: f.id,
                  ruleType: f.ruleType,
                  params: f.params,
                  name: f.name,
                  mode: f.mode,
                }}
                library
                onDelete={() =>
                  detachLibMut.mutate(
                    { subscriptionId: sub.id, libraryFilterId: f.id },
                    {
                      onSuccess: () => toast.show('Library filter detached'),
                      onError: () => toast.show('Failed to detach'),
                    },
                  )
                }
                deleteLabel="Detach from subscription"
              />
            ))}
            {own.map((f) => (
              <FilterRow
                key={`own-${f.id}`}
                filter={{
                  id: f.id,
                  ruleType: f.ruleType,
                  params: f.params,
                  enabled: f.enabled,
                  mode: f.mode,
                }}
                onToggle={() =>
                  updateMut.mutate(
                    {
                      subscriptionId: sub.id,
                      filterId: f.id,
                      body: { enabled: !f.enabled },
                    },
                    { onError: () => toast.show('Failed to update') },
                  )
                }
                onEdit={() => openEditFilter(f)}
                onDelete={() =>
                  deleteMut.mutate(
                    { subscriptionId: sub.id, filterId: f.id },
                    {
                      onSuccess: () => toast.show('Filter removed'),
                      onError: () => toast.show('Failed to delete'),
                    },
                  )
                }
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}
