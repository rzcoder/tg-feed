import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-text-muted h-full px-8 py-12">
      <span className="grid place-items-center w-12 h-12 mb-3.5 rounded-xl bg-surface-2 border border-border text-text-muted">
        {icon}
      </span>
      <div className="text-[15px] font-semibold text-text tracking-tight">{title}</div>
      <div className="text-[13px] mt-1.5 max-w-[260px] leading-relaxed">{body}</div>
      {cta && <div className="mt-4.5">{cta}</div>}
    </div>
  );
}
