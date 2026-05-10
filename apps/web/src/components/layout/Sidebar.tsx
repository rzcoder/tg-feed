import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LogoBadge } from '@/components/domain/Logo';
import { ConnectionPill } from '@/components/domain/ConnectionPill';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/hooks/useAuth';
import { useActivityStream } from '@/hooks/useActivityStream';
import { NAV_TABS } from './TabBar';

export function Sidebar({ className }: { className?: string }) {
  const logout = useLogout();
  const { state } = useActivityStream();

  return (
    <aside
      className={cn(
        'w-[224px] flex-shrink-0 flex flex-col border-r border-border bg-bg-2 px-3 py-3.5',
        className,
      )}
      aria-label="Primary"
    >
      <div className="flex items-center gap-2 px-2 pb-4">
        <LogoBadge size={17} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">tg-feed</span>
          <span className="text-[11px] text-text-muted">operator console</span>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_TABS.map(({ to, icon: Icon, full, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13.5px] tracking-tight cursor-default',
                isActive
                  ? 'bg-surface-2 text-text font-medium'
                  : 'bg-transparent text-text-2 font-normal hover:bg-surface',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.7}
                  className={isActive ? 'text-accent' : 'text-text-muted'}
                />
                {full}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto pt-2 border-t border-border">
        <div className="flex items-center justify-between py-1.5 px-1">
          <span className="text-[11px] text-text-muted">Stream</span>
          <ConnectionPill state={state} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start mt-1"
          onClick={() =>
            logout.mutate(undefined, { onSettled: () => window.location.assign('/login') })
          }
          disabled={logout.isPending}
        >
          <LogOut size={14} />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
