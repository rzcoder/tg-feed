/**
 * Filter rule registry.
 *
 * Factory pattern — `createRegistry()` returns a fresh, empty registry.
 * Production wiring builds one via `createDefaultRegistry()` (in
 * `rules/index.ts`) and registers all v1 rules; tests can build empty or
 * partial registries without import-order side effects.
 *
 * `register` accepts a statically-typed `FilterRule<T>` and stores it as a
 * type-erased `RegisteredFilterRule`. The cast is the boundary: at register
 * time the rule's `T` ↔ params correlation is known; once retrieved by string
 * lookup, the relationship is gone and runtime zod validation takes over.
 */
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
