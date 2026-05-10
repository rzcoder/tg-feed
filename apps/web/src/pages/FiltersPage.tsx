import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilterRuleType } from '@tg-feed/shared';
import { FilterSheetController } from '@/components/filters/FilterSheetController';
import { LibraryView } from '@/components/filters/LibraryView';
import { PerSubView } from '@/components/filters/PerSubView';
import { SubTabs, type FiltersView } from '@/components/filters/SubTabs';
import { useFilterCatalog, useLibraryFilters } from '@/hooks/useFilters';
import { useFilterSheetState } from '@/hooks/useFilterSheetState';
import { useSubscriptions } from '@/hooks/useSubscriptions';

export function FiltersPage() {
  const [params, setParams] = useSearchParams();
  const view: FiltersView = params.get('view') === 'library' ? 'library' : 'sub';
  const subParam = params.get('sub');
  const subId = subParam ? Number(subParam) : null;

  const setView = (next: FiltersView) => {
    const updated = new URLSearchParams(params);
    updated.set('view', next);
    setParams(updated, { replace: true });
  };

  const setSubId = (next: number | null) => {
    const updated = new URLSearchParams(params);
    if (next === null) updated.delete('sub');
    else updated.set('sub', String(next));
    setParams(updated, { replace: true });
  };

  const subs = useSubscriptions();
  const library = useLibraryFilters();
  const catalog = useFilterCatalog();
  const availableTypes = useMemo<readonly FilterRuleType[]>(
    () => (catalog.data ?? []).map((c) => c.type),
    [catalog.data],
  );

  // Default to first sub if none in URL.
  useEffect(() => {
    if (view !== 'sub') return;
    if (subId !== null) return;
    if ((subs.data?.length ?? 0) > 0) {
      setSubId(subs.data![0]!.id);
    }
  }, [view, subId, subs.data, setSubId]);

  const sheet = useFilterSheetState();

  return (
    <div className="flex flex-col flex-1 min-h-0 pt-3">
      <SubTabs value={view} onChange={setView} libraryCount={library.data?.length ?? 0} />
      {view === 'sub' ? (
        <PerSubView
          activeSubId={subId}
          setSubId={setSubId}
          availableTypes={availableTypes}
          openAddFilter={() => subId !== null && sheet.openAdd('sub')}
          openEditFilter={(f) => sheet.openEdit('sub', f)}
          subsLoading={subs.isPending}
          subs={subs.data ?? []}
          librarySource={library.data ?? []}
        />
      ) : (
        <LibraryView
          openAdd={() => sheet.openAdd('library')}
          openEdit={(f) => sheet.openEdit('library', f)}
        />
      )}
      <FilterSheetController
        sheet={sheet}
        onClose={sheet.close}
        availableTypes={availableTypes}
        subscriptionId={subId}
      />
    </div>
  );
}
