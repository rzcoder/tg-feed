import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number | string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between px-4.5 pt-4 pb-2', className)}>
      <div className="flex items-baseline gap-2">
        <span className="text-[18px] font-semibold tracking-tight">{title}</span>
        {count !== undefined && (
          <span className="text-[13px] text-text-muted tabular-nums">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}
