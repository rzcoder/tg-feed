import type { ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';

export interface ListStateProps {
  pending: boolean;
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
}

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
