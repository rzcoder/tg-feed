import { cn } from '@/lib/cn';

export type FiltersView = 'sub' | 'library';

interface Option {
  value: FiltersView;
  label: string;
  count?: number;
}

interface SubTabsProps {
  value: FiltersView;
  onChange: (next: FiltersView) => void;
  libraryCount: number;
}

export function SubTabs({ value, onChange, libraryCount }: SubTabsProps) {
  const opts: Option[] = [
    { value: 'sub', label: 'Per-subscription' },
    { value: 'library', label: 'Library', count: libraryCount },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 p-1 bg-surface-2 border border-border rounded-[9px] mx-4.5 mb-2">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-[30px] rounded-md flex items-center justify-center gap-1.5 text-[12.5px] tracking-tight cursor-default transition-colors',
            value === o.value
              ? 'bg-bg text-text font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
              : 'bg-transparent text-text-muted font-medium',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span
              className={cn(
                'inline-flex items-center px-1.5 h-4 rounded-full text-[10.5px] font-semibold',
                value === o.value ? 'bg-surface-2 text-text-muted' : 'bg-surface-3 text-text-muted',
              )}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
