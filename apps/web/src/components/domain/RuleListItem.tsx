import { ChevronRight } from 'lucide-react';
import type { FilterRuleType } from '@tg-feed/shared';
import {
  FILTER_RULE_DESCRIPTIONS,
  FILTER_RULE_ICONS,
  FILTER_RULE_LABELS,
} from '@/lib/describeFilter';
import { cn } from '@/lib/cn';

export interface RuleListItemProps {
  ruleType: FilterRuleType;
  selected?: boolean;
  onClick: () => void;
}

export function RuleListItem({ ruleType, selected, onClick }: RuleListItemProps) {
  const Icon = FILTER_RULE_ICONS[ruleType];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3.5 py-3 text-left border-t border-border first:border-t-0 transition-colors',
        selected ? 'bg-accent-soft' : 'bg-bg hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'grid place-items-center w-8 h-8 rounded-lg flex-shrink-0',
          selected ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text-2',
        )}
      >
        <Icon size={15} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13.5px] font-medium tracking-tight">
          {FILTER_RULE_LABELS[ruleType]}
        </div>
        <div className="text-[11.5px] text-text-muted leading-snug">
          {FILTER_RULE_DESCRIPTIONS[ruleType]}
        </div>
      </div>
      <ChevronRight size={16} className={selected ? 'text-accent' : 'text-text-faint'} />
    </button>
  );
}
