import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxCardProps {
  checked: boolean;
  onToggle: () => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  descriptionClassName?: string;
}

export function CheckboxCard({
  checked,
  onToggle,
  label,
  description,
  disabled,
  tone = 'default',
  descriptionClassName,
}: CheckboxCardProps) {
  const danger = tone === 'danger';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        disabled
          ? 'bg-bg border border-border opacity-50 cursor-not-allowed'
          : checked
            ? danger
              ? 'bg-danger-soft border border-danger/40'
              : 'bg-accent-soft border border-accent'
            : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded grid place-items-center border-[1.5px] flex-shrink-0',
          checked
            ? danger
              ? 'border-danger bg-danger'
              : 'border-accent bg-accent'
            : 'border-border-strong',
        )}
      >
        {checked && (
          <Check size={11} strokeWidth={3} className={danger ? 'text-white' : 'text-accent-fg'} />
        )}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">{label}</div>
        {description !== undefined && (
          <div className={cn('text-[11px] text-text-muted', descriptionClassName)}>
            {description}
          </div>
        )}
      </div>
    </button>
  );
}
