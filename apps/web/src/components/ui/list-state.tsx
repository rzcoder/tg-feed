import type { ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';

export interface ListStateProps {
  /** Query is loading — shows a centered spinner. */
  pending: boolean;
  /** Loaded but no rows — shows `empty`. */
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
}

/** The loading → empty → list ladder shared by the resource list pages. */
export function ListState({ pending, isEmpty, empty, children }: ListStateProps) {
  if (pending) {
    return (
      <div className="grid place-items-center py-12 text-text-muted">
        <Spinner />
      </div>
    );
  }
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
