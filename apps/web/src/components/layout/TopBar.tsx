import type { LucideIcon } from 'lucide-react';
import { IconBadge, LogoBadge } from '@/components/domain/Logo';

export function TopBar({ title, icon }: { title: string; icon?: LucideIcon | undefined }) {
  return (
    <header
      className="flex items-center h-[52px] flex-shrink-0 px-4 border-b border-border bg-bg z-10 relative"
      role="banner"
    >
      <div className="flex items-center gap-2">
        {icon ? <IconBadge icon={icon} /> : <LogoBadge />}
        <span className="text-[14.5px] font-semibold tracking-tight">{title}</span>
      </div>
    </header>
  );
}
