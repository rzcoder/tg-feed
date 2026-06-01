import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FabProps {
  onClick: () => void;
  label: string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Floating action button — anchored to the bottom-right of the nearest
 * positioned ancestor (the app's <main>), so it floats above the page
 * content and clears the mobile tab bar.
 */
export function Fab({ onClick, label, children, className }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'absolute bottom-5 right-5 z-20 grid place-items-center h-14 w-14 rounded-full',
        'bg-accent text-accent-fg border border-accent shadow-lg',
        'transition-transform duration-100 active:scale-95 hover:bg-accent-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}
