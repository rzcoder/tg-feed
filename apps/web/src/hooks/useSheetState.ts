// Generic add/edit sheet state: open/mode/initial as one object so it can't go inconsistent.
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
