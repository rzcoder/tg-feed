// Single-object state for the FiltersPage sheet so callers can't desync open/mode/kind/initial.
import { useCallback, useState } from 'react';
import type { LibraryFilterDto, SubscriptionFilterDto } from '@tg-feed/shared';

export type FilterSheetKind = 'sub' | 'library';
export type FilterSheetMode = 'add' | 'edit';
export type FilterSheetInitial = SubscriptionFilterDto | LibraryFilterDto | null;

export interface FilterSheetState {
  open: boolean;
  mode: FilterSheetMode;
  kind: FilterSheetKind;
  initial: FilterSheetInitial;
}

export interface FilterSheetHandle extends FilterSheetState {
  openAdd(kind: FilterSheetKind): void;
  openEdit(kind: FilterSheetKind, initial: SubscriptionFilterDto | LibraryFilterDto): void;
  close(): void;
}

const CLOSED: FilterSheetState = { open: false, mode: 'add', kind: 'sub', initial: null };

export function useFilterSheetState(): FilterSheetHandle {
  const [state, setState] = useState<FilterSheetState>(CLOSED);

  const openAdd = useCallback((kind: FilterSheetKind) => {
    setState({ open: true, mode: 'add', kind, initial: null });
  }, []);
  const openEdit = useCallback(
    (kind: FilterSheetKind, initial: SubscriptionFilterDto | LibraryFilterDto) => {
      setState({ open: true, mode: 'edit', kind, initial });
    },
    [],
  );
  const close = useCallback(() => setState(CLOSED), []);

  return { ...state, openAdd, openEdit, close };
}
