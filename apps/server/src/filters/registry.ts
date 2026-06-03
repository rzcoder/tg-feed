// register() type-erases FilterRule<T> to RegisteredFilterRule; the T↔params link is lost on lookup, so runtime zod validates.
import type { FilterRuleType } from '@tg-feed/shared';
import type { FilterRule, RegisteredFilterRule } from './types.js';

export interface FilterRegistry {
  register<T extends FilterRuleType>(rule: FilterRule<T>): void;
  getRule(type: string): RegisteredFilterRule | undefined;
  listRules(): readonly RegisteredFilterRule[];
}

export function createRegistry(): FilterRegistry {
  const rules = new Map<FilterRuleType, RegisteredFilterRule>();

  return {
    register<T extends FilterRuleType>(rule: FilterRule<T>): void {
      if (rules.has(rule.type)) {
        throw new Error(`Filter rule already registered: ${rule.type}`);
      }
      rules.set(rule.type, rule as unknown as RegisteredFilterRule);
    },
    getRule(type: string): RegisteredFilterRule | undefined {
      return rules.get(type as FilterRuleType);
    },
    listRules(): readonly RegisteredFilterRule[] {
      return [...rules.values()];
    },
  };
}
