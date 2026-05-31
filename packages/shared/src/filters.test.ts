import { describe, it, expect } from 'vitest';
import {
  FILTER_RULE_TYPES,
  filterRuleParamsSchemas,
  hasMediaParamsSchema,
  minLengthParamsSchema,
  senderAllowlistParamsSchema,
  textContainsParamsSchema,
  textExcludesParamsSchema,
  textRegexParamsSchema,
} from './filters.js';

describe('FILTER_RULE_TYPES', () => {
  it('lists exactly the six v1 rules', () => {
    expect([...FILTER_RULE_TYPES]).toEqual([
      'text-contains',
      'text-excludes',
      'text-regex',
      'has-media',
      'min-length',
      'sender-allowlist',
    ]);
  });

  it('has a schema for every rule type', () => {
    for (const type of FILTER_RULE_TYPES) {
      expect(filterRuleParamsSchemas[type]).toBeDefined();
    }
  });
});

describe('textContainsParamsSchema', () => {
  it('accepts value with caseInsensitive default', () => {
    const parsed = textContainsParamsSchema.parse({ value: 'foo' });
    expect(parsed).toEqual({ value: 'foo', caseInsensitive: true });
  });

  it('accepts explicit caseInsensitive=false', () => {
    expect(textContainsParamsSchema.parse({ value: 'foo', caseInsensitive: false })).toEqual({
      value: 'foo',
      caseInsensitive: false,
    });
  });

  it('rejects empty value', () => {
    expect(textContainsParamsSchema.safeParse({ value: '' }).success).toBe(false);
  });

  it('rejects missing value', () => {
    expect(textContainsParamsSchema.safeParse({}).success).toBe(false);
  });
});

describe('textExcludesParamsSchema', () => {
  it('accepts value with caseInsensitive default', () => {
    expect(textExcludesParamsSchema.parse({ value: 'spam' })).toEqual({
      value: 'spam',
      caseInsensitive: true,
    });
  });

  it('rejects empty value', () => {
    expect(textExcludesParamsSchema.safeParse({ value: '' }).success).toBe(false);
  });
});

describe('textRegexParamsSchema', () => {
  it('accepts pattern with default empty flags', () => {
    expect(textRegexParamsSchema.parse({ pattern: '^foo' })).toEqual({
      pattern: '^foo',
      flags: '',
    });
  });

  it('accepts explicit flags', () => {
    expect(textRegexParamsSchema.parse({ pattern: '^foo', flags: 'i' })).toEqual({
      pattern: '^foo',
      flags: 'i',
    });
  });

  it('rejects empty pattern', () => {
    expect(textRegexParamsSchema.safeParse({ pattern: '' }).success).toBe(false);
  });
});

describe('hasMediaParamsSchema', () => {
  it('defaults required to true', () => {
    expect(hasMediaParamsSchema.parse({})).toEqual({ required: true });
  });

  it('accepts required=false', () => {
    expect(hasMediaParamsSchema.parse({ required: false })).toEqual({ required: false });
  });

  it('rejects non-boolean required', () => {
    expect(hasMediaParamsSchema.safeParse({ required: 'yes' }).success).toBe(false);
  });
});

describe('minLengthParamsSchema', () => {
  it('accepts non-negative integers', () => {
    expect(minLengthParamsSchema.parse({ min: 0 })).toEqual({ min: 0 });
    expect(minLengthParamsSchema.parse({ min: 100 })).toEqual({ min: 100 });
  });

  it('rejects negative numbers', () => {
    expect(minLengthParamsSchema.safeParse({ min: -1 }).success).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(minLengthParamsSchema.safeParse({ min: 1.5 }).success).toBe(false);
  });
});

describe('senderAllowlistParamsSchema', () => {
  it('accepts a non-empty list of usernames', () => {
    expect(senderAllowlistParamsSchema.parse({ usernames: ['alice', 'bob'] })).toEqual({
      usernames: ['alice', 'bob'],
    });
  });

  it('rejects an empty list', () => {
    expect(senderAllowlistParamsSchema.safeParse({ usernames: [] }).success).toBe(false);
  });

  it('rejects an empty username string', () => {
    expect(senderAllowlistParamsSchema.safeParse({ usernames: [''] }).success).toBe(false);
  });
});
