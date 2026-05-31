/**
 * Generic add/edit sheet state.
 *
 * Wraps the four-piece (open/mode/initial) shape every CRUD page redeclares
 * with `useState`. Keeps the open/mode/initial trio in a single object so
 * the sheet never lands in an inconsistent state.
 */
import { useCallback, useState } from 'react';

export type SheetMode = 'add' | 'edit';

export interface SheetState<T> {
  open: boolean;
  mode: SheetMode;
  initial: T | null;
}

export interface SheetHandle<T> extends SheetState<T> {
  openAdd(): void;
  openEdit(initial: T): void;
  close(): void;
}

const CLOSED = { open: false, mode: 'add', initial: null } as const;

export function useSheetState<T>(): SheetHandle<T> {
  const [state, setState] = useState<SheetState<T>>(CLOSED);

  const openAdd = useCallback(() => {
    setState({ open: true, mode: 'add', initial: null });
  }, []);
  const openEdit = useCallback((initial: T) => {
    setState({ open: true, mode: 'edit', initial });
  }, []);
  const close = useCallback(() => setState(CLOSED), []);

  return { ...state, openAdd, openEdit, close };
}
