import { describe, it, expect } from 'vitest';
import { FILTER_RULE_TYPES } from '@tg-feed/shared';
import { createRegistry } from './registry.js';
import { createDefaultRegistry } from './rules/index.js';
import { textContainsRule } from './rules/textContains.js';

describe('createRegistry', () => {
  it('returns an empty registry', () => {
    const registry = createRegistry();
    expect(registry.listRules()).toEqual([]);
    expect(registry.getRule('text-contains')).toBeUndefined();
  });

  it('register + getRule round-trip', () => {
    const registry = createRegistry();
    registry.register(textContainsRule);
    expect(registry.getRule('text-contains')).toBe(textContainsRule);
    expect(registry.listRules()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const registry = createRegistry();
    registry.register(textContainsRule);
    expect(() => registry.register(textContainsRule)).toThrow(/already registered/);
  });

  it('returns undefined for unknown rule types', () => {
    const registry = createRegistry();
    expect(registry.getRule('does-not-exist')).toBeUndefined();
  });
});

describe('createDefaultRegistry', () => {
  it('registers exactly the six v1 rules', () => {
    const registry = createDefaultRegistry();
    const types = registry.listRules().map((r) => r.type);
    expect(types).toHaveLength(FILTER_RULE_TYPES.length);
    expect(new Set(types)).toEqual(new Set(FILTER_RULE_TYPES));
  });

  it('every rule lookup resolves', () => {
    const registry = createDefaultRegistry();
    for (const type of FILTER_RULE_TYPES) {
      expect(registry.getRule(type)?.type).toBe(type);
    }
  });
});
