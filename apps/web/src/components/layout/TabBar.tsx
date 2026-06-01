import { NavLink } from 'react-router-dom';
import { Activity, Filter, Rss, Send, Settings, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface NavTab {
  to: string;
  icon: LucideIcon;
  label: string;
  full: string;
  end: boolean;
}

export const NAV_TABS: readonly NavTab[] = [
  { to: '/', icon: Rss, label: 'Subs', full: 'Subscriptions', end: true },
  { to: '/destinations', icon: Send, label: 'Dests', full: 'Destinations', end: false },
  { to: '/filters', icon: Filter, label: 'Filters', full: 'Filters', end: false },
  { to: '/activity', icon: Activity, label: 'Activity', full: 'Activity', end: false },
  { to: '/settings', icon: Settings, label: 'Settings', full: 'Settings', end: false },
];

export interface TabBarProps {
  className?: string;
}

export function TabBar({ className }: TabBarProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'h-16 flex-shrink-0 grid border-t border-border bg-bg pb-2 relative',
        'grid-cols-5',
        className,
      )}
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
    >
      {NAV_TABS.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center justify-center gap-[3px] pt-1.5 cursor-default',
              'transition-colors duration-100 select-none',
              isActive ? 'text-accent' : 'text-text-muted',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'w-9 h-[22px] grid place-items-center rounded-full transition-colors duration-150',
                  isActive ? 'bg-accent-soft' : 'bg-transparent',
                )}
              >
                <Icon size={17} strokeWidth={isActive ? 2.1 : 1.7} />
              </span>
              <span
                className={cn(
                  'text-[10.5px] tracking-wide',
                  isActive ? 'font-semibold' : 'font-medium',
                )}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
