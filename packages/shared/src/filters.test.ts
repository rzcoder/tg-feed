import { describe, it, expect } from 'vitest';
import {
  FILTER_RULE_TYPES,
  filterRuleParamsSchemas,
  hasMediaParamsSchema,
  linkPrefixParamsSchema,
  minLengthParamsSchema,
  senderAllowlistParamsSchema,
  textContainsParamsSchema,
  textExcludesParamsSchema,
  textRegexParamsSchema,
} from './filters.js';

describe('FILTER_RULE_TYPES', () => {
  it('lists every rule type, link-prefix last', () => {
    expect([...FILTER_RULE_TYPES]).toEqual([
      'text-contains',
      'text-excludes',
      'text-regex',
      'has-media',
      'min-length',
      'sender-allowlist',
      'link-prefix',
    ]);
  });

  it('has a schema for every rule type', () => {
    for (const type of FILTER_RULE_TYPES) {
      expect(filterRuleParamsSchemas[type]).toBeDefined();
    }
  });
});

describe('textContainsParamsSchema', () => {
  it('accepts value with caseInsensitive + includeEntities defaults', () => {
    const parsed = textContainsParamsSchema.parse({ value: 'foo' });
    expect(parsed).toEqual({ value: 'foo', caseInsensitive: true, includeEntities: false });
  });

  it('accepts explicit caseInsensitive=false and includeEntities=true', () => {
    expect(
      textContainsParamsSchema.parse({
        value: 'foo',
        caseInsensitive: false,
        includeEntities: true,
      }),
    ).toEqual({ value: 'foo', caseInsensitive: false, includeEntities: true });
  });

  it('rejects empty value', () => {
    expect(textContainsParamsSchema.safeParse({ value: '' }).success).toBe(false);
  });

  it('rejects missing value', () => {
    expect(textContainsParamsSchema.safeParse({}).success).toBe(false);
  });
});

describe('textExcludesParamsSchema', () => {
  it('accepts value with defaults', () => {
    expect(textExcludesParamsSchema.parse({ value: 'spam' })).toEqual({
      value: 'spam',
      caseInsensitive: true,
      includeEntities: false,
    });
  });

  it('rejects empty value', () => {
    expect(textExcludesParamsSchema.safeParse({ value: '' }).success).toBe(false);
  });
});

describe('textRegexParamsSchema', () => {
  it('accepts pattern with default empty flags and includeEntities=false', () => {
    expect(textRegexParamsSchema.parse({ pattern: '^foo' })).toEqual({
      pattern: '^foo',
      flags: '',
      includeEntities: false,
    });
  });

  it('accepts explicit flags', () => {
    expect(textRegexParamsSchema.parse({ pattern: '^foo', flags: 'i' })).toEqual({
      pattern: '^foo',
      flags: 'i',
      includeEntities: false,
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

  it('accepts a media-count comparison', () => {
    expect(hasMediaParamsSchema.parse({ required: true, countOp: 'gt', count: 3 })).toEqual({
      required: true,
      countOp: 'gt',
      count: 3,
    });
  });

  it('rejects countOp without count and count without countOp', () => {
    expect(hasMediaParamsSchema.safeParse({ required: true, countOp: 'gt' }).success).toBe(false);
    expect(hasMediaParamsSchema.safeParse({ required: true, count: 3 }).success).toBe(false);
  });

  it('rejects a count comparison alongside required=false', () => {
    expect(
      hasMediaParamsSchema.safeParse({ required: false, countOp: 'lt', count: 2 }).success,
    ).toBe(false);
  });

  it('rejects out-of-range or non-integer counts', () => {
    expect(
      hasMediaParamsSchema.safeParse({ required: true, countOp: 'gt', count: 0 }).success,
    ).toBe(false);
    expect(
      hasMediaParamsSchema.safeParse({ required: true, countOp: 'gt', count: 2.5 }).success,
    ).toBe(false);
  });

  it('rejects an unknown countOp', () => {
    expect(
      hasMediaParamsSchema.safeParse({ required: true, countOp: 'eq', count: 2 }).success,
    ).toBe(false);
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

describe('linkPrefixParamsSchema', () => {
  it('defaults scope to "both"', () => {
    expect(linkPrefixParamsSchema.parse({ value: 't.me' })).toEqual({
      value: 't.me',
      scope: 'both',
    });
  });

  it('accepts each scope literal', () => {
    for (const scope of ['text', 'entity', 'both'] as const) {
      expect(linkPrefixParamsSchema.parse({ value: 't.me', scope })).toEqual({
        value: 't.me',
        scope,
      });
    }
  });

  it('rejects empty value', () => {
    expect(linkPrefixParamsSchema.safeParse({ value: '' }).success).toBe(false);
  });

  it('rejects an unknown scope', () => {
    expect(linkPrefixParamsSchema.safeParse({ value: 't.me', scope: 'everywhere' }).success).toBe(
      false,
    );
  });
});
