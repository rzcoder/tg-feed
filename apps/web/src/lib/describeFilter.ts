import {
  Ban,
  FileImage,
  Link2,
  Regex,
  Ruler,
  TextCursorInput,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { FilterMode, FilterRuleType } from '@tg-feed/shared';

export interface FilterLike {
  ruleType: FilterRuleType;
  params: Record<string, unknown>;
  mode?: FilterMode;
}

const entitiesSuffix = (p: Record<string, unknown>): string =>
  p.includeEntities === true ? ' + links' : '';

const LINK_SCOPE_LABELS: Record<string, string> = {
  text: ' in text',
  entity: ' in link targets',
  both: '',
};

export function describeFilter(f: FilterLike): string {
  const p = f.params;
  const prefix = f.mode === 'exclude' ? 'Exclude: ' : '';
  switch (f.ruleType) {
    case 'text-contains': {
      const value = (p.value as string) ?? '';
      const caseInsensitive = p.caseInsensitive !== false;
      return `${prefix}contains "${value}"${caseInsensitive ? ' (case-insensitive)' : ''}${entitiesSuffix(p)}`;
    }
    case 'text-excludes': {
      const value = (p.value as string) ?? '';
      const caseInsensitive = p.caseInsensitive !== false;
      return `${prefix}excludes "${value}"${caseInsensitive ? ' (case-insensitive)' : ''}${entitiesSuffix(p)}`;
    }
    case 'text-regex': {
      const pattern = (p.pattern as string) ?? '';
      const flags = (p.flags as string) ?? '';
      return `${prefix}/${pattern}/${flags}${entitiesSuffix(p)}`;
    }
    case 'link-prefix': {
      const value = (p.value as string) ?? '';
      const scope = (p.scope as string) ?? 'both';
      return `${prefix}link starts with "${value}"${LINK_SCOPE_LABELS[scope] ?? ''}`;
    }
    case 'has-media': {
      const base = p.required === false ? 'must NOT have media' : 'must have media';
      if (p.countOp && p.count !== undefined) {
        const sym = p.countOp === 'gt' ? '>' : '<';
        return `${prefix}${base} (count ${sym} ${p.count})`;
      }
      return `${prefix}${base}`;
    }
    case 'min-length': {
      return `${prefix}min length ${p.min ?? 0}`;
    }
    case 'sender-allowlist': {
      const usernames = (p.usernames as string[]) ?? [];
      return `${prefix}sender ∈ [${usernames.join(', ')}]`;
    }
  }
}

export interface FilterRuleMeta {
  label: string;
  description: string;
  icon: LucideIcon;
}

export const FILTER_RULE_META: Record<FilterRuleType, FilterRuleMeta> = {
  'text-contains': {
    label: 'Text contains',
    description: 'Match if message body contains a substring.',
    icon: TextCursorInput,
  },
  'text-excludes': {
    label: 'Text excludes',
    description: 'Drop if message body contains a substring.',
    icon: Ban,
  },
  'text-regex': {
    label: 'Text matches regex',
    description: 'Full regex match against message body.',
    icon: Regex,
  },
  'has-media': {
    label: 'Has media',
    description: 'Match only messages that include media (or only those without).',
    icon: FileImage,
  },
  'min-length': {
    label: 'Minimum length',
    description: 'Drop messages shorter than N characters.',
    icon: Ruler,
  },
  'sender-allowlist': {
    label: 'Sender allowlist',
    description: 'Forward only when sender is on a small list.',
    icon: User,
  },
  'link-prefix': {
    label: 'Link prefix',
    description: 'Match links by how they start; protocol optional.',
    icon: Link2,
  },
};

export const FILTER_RULE_LABELS: Record<FilterRuleType, string> = Object.fromEntries(
  Object.entries(FILTER_RULE_META).map(([k, v]) => [k, v.label]),
) as Record<FilterRuleType, string>;

export const FILTER_RULE_DESCRIPTIONS: Record<FilterRuleType, string> = Object.fromEntries(
  Object.entries(FILTER_RULE_META).map(([k, v]) => [k, v.description]),
) as Record<FilterRuleType, string>;

export const FILTER_RULE_ICONS: Record<FilterRuleType, LucideIcon> = Object.fromEntries(
  Object.entries(FILTER_RULE_META).map(([k, v]) => [k, v.icon]),
) as Record<FilterRuleType, LucideIcon>;
