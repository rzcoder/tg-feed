import { describe, expect, it } from 'vitest';
import {
  createLibraryFilterRequestSchema,
  createSubscriptionFilterRequestSchema,
  createSubscriptionRequestSchema,
  forwardLogQuerySchema,
  inlineFilterInputSchema,
  isValidTimeZone,
  loginRequestSchema,
  settingsDtoSchema,
  updateSettingsRequestSchema,
  updateSubscriptionFilterRequestSchema,
  updateSubscriptionRequestSchema,
} from './api.js';
import { FILTER_RULE_TYPES } from './filters.js';

// Guards against forgetting a branch when a rule type is added: the hand-listed discriminated unions
// must stay in lockstep with FILTER_RULE_TYPES.
const coveredRuleTypes = (union: { options: readonly unknown[] }): string[] =>
  union.options.map((o) => (o as { shape: { ruleType: { value: string } } }).shape.ruleType.value);

describe('filter input unions', () => {
  it('inlineFilterInputSchema has a branch for every rule type', () => {
    expect(coveredRuleTypes(inlineFilterInputSchema).sort()).toEqual([...FILTER_RULE_TYPES].sort());
  });

  it('createLibraryFilterRequestSchema has a branch for every rule type', () => {
    expect(coveredRuleTypes(createLibraryFilterRequestSchema).sort()).toEqual(
      [...FILTER_RULE_TYPES].sort(),
    );
  });
});

describe('loginRequestSchema', () => {
  it('accepts a non-empty password', () => {
    expect(loginRequestSchema.parse({ password: 'hunter2' })).toEqual({ password: 'hunter2' });
  });
  it('rejects empty password', () => {
    expect(loginRequestSchema.safeParse({ password: '' }).success).toBe(false);
  });
  it('rejects missing password', () => {
    expect(loginRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('createSubscriptionRequestSchema', () => {
  it('accepts a minimal valid body', () => {
    const result = createSubscriptionRequestSchema.parse({
      sourceChatId: '-100123',
      sourceTitle: 'src',
      destinationId: 1,
    });
    expect(result.sourceChatId).toBe('-100123');
    expect(result.destinationId).toBe(1);
    expect(result.enabled).toBeUndefined();
  });
  it('accepts explicit enabled and handle', () => {
    const result = createSubscriptionRequestSchema.parse({
      sourceChatId: '-100123',
      sourceTitle: 'src',
      handle: '@src',
      destinationId: 1,
      enabled: false,
    });
    expect(result.enabled).toBe(false);
    expect(result.handle).toBe('@src');
  });
  it('rejects missing sourceChatId', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceTitle: 'src',
        destinationId: 1,
      }).success,
    ).toBe(false);
  });
  it('accepts missing destinationId (subscription created in detached state)', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceChatId: '-100123',
        sourceTitle: 'src',
      }).success,
    ).toBe(true);
  });
  it('accepts an explicit null destinationId', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceChatId: '-100123',
        sourceTitle: 'src',
        destinationId: null,
      }).success,
    ).toBe(true);
  });
  it('rejects empty string fields', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceChatId: '',
        sourceTitle: 'src',
        destinationId: 1,
      }).success,
    ).toBe(false);
  });
});

describe('updateSubscriptionRequestSchema', () => {
  it('accepts a single-field PATCH', () => {
    expect(updateSubscriptionRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
  it('rejects an empty body', () => {
    expect(updateSubscriptionRequestSchema.safeParse({}).success).toBe(false);
  });
  it('accepts an inlineFilters-only PATCH (bulk-replace)', () => {
    const parsed = updateSubscriptionRequestSchema.parse({
      inlineFilters: [{ ruleType: 'text-contains', params: { value: 'foo' } }],
    });
    expect(parsed.inlineFilters).toHaveLength(1);
  });
  it('accepts an empty inlineFilters array (drop all)', () => {
    expect(updateSubscriptionRequestSchema.parse({ inlineFilters: [] }).inlineFilters).toEqual([]);
  });
});

describe('createSubscriptionRequestSchema inlineFilters', () => {
  const base = {
    sourceChatId: '-100123',
    sourceTitle: 'src',
    destinationId: 1,
  };
  it('accepts a valid inlineFilters array', () => {
    const parsed = createSubscriptionRequestSchema.parse({
      ...base,
      inlineFilters: [
        { ruleType: 'text-contains', params: { value: 'a' } },
        { ruleType: 'min-length', params: { min: 10 }, enabled: false },
      ],
    });
    expect(parsed.inlineFilters).toHaveLength(2);
    expect(parsed.inlineFilters?.[1]?.enabled).toBe(false);
  });
  it('rejects mismatched params for the declared ruleType', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        ...base,
        inlineFilters: [{ ruleType: 'text-contains', params: { min: 5 } }],
      }).success,
    ).toBe(false);
  });
  it('rejects an unknown ruleType inside inlineFilters', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        ...base,
        inlineFilters: [{ ruleType: 'no-such-rule', params: {} }],
      }).success,
    ).toBe(false);
  });
  it('omits inlineFilters when absent', () => {
    const parsed = createSubscriptionRequestSchema.parse(base);
    expect(parsed.inlineFilters).toBeUndefined();
  });
});

describe('createSubscriptionFilterRequestSchema (discriminated union)', () => {
  it('accepts a valid text-contains filter', () => {
    const result = createSubscriptionFilterRequestSchema.parse({
      ruleType: 'text-contains',
      params: { value: 'hello' },
    });
    expect(result.ruleType).toBe('text-contains');
    if (result.ruleType === 'text-contains') {
      expect(result.params.value).toBe('hello');
      // caseInsensitive .default(true) applies on parse
      expect(result.params.caseInsensitive).toBe(true);
    }
  });
  it('rejects text-contains with missing value', () => {
    expect(
      createSubscriptionFilterRequestSchema.safeParse({
        ruleType: 'text-contains',
        params: {},
      }).success,
    ).toBe(false);
  });
  it('rejects an unknown ruleType', () => {
    expect(
      createSubscriptionFilterRequestSchema.safeParse({
        ruleType: 'no-such-rule',
        params: {},
      }).success,
    ).toBe(false);
  });
  it('rejects mismatched params (text-contains body with min-length params)', () => {
    expect(
      createSubscriptionFilterRequestSchema.safeParse({
        ruleType: 'text-contains',
        params: { min: 5 },
      }).success,
    ).toBe(false);
  });
  it('accepts a sender-allowlist filter with usernames array', () => {
    const result = createSubscriptionFilterRequestSchema.parse({
      ruleType: 'sender-allowlist',
      params: { usernames: ['alice', 'bob'] },
    });
    if (result.ruleType === 'sender-allowlist') {
      expect(result.params.usernames).toEqual(['alice', 'bob']);
    }
  });
});

describe('updateSubscriptionFilterRequestSchema', () => {
  it('accepts an enabled-only patch (params not validated at this layer)', () => {
    expect(updateSubscriptionFilterRequestSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
  });
  it('accepts a params-only patch with loose record shape', () => {
    expect(
      updateSubscriptionFilterRequestSchema.parse({ params: { whatever: 1, deep: { ok: true } } }),
    ).toEqual({ params: { whatever: 1, deep: { ok: true } } });
  });
  it('rejects an empty body', () => {
    expect(updateSubscriptionFilterRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('updateSettingsRequestSchema', () => {
  it('accepts a positive integer delayMs', () => {
    expect(updateSettingsRequestSchema.parse({ delayMs: 5000 })).toEqual({ delayMs: 5000 });
  });
  it('rejects delayMs of 0', () => {
    expect(updateSettingsRequestSchema.safeParse({ delayMs: 0 }).success).toBe(false);
  });
  it('rejects negative delayMs', () => {
    expect(updateSettingsRequestSchema.safeParse({ delayMs: -1 }).success).toBe(false);
  });
  it('rejects missing delayMs', () => {
    expect(updateSettingsRequestSchema.safeParse({}).success).toBe(false);
  });
  it('rejects non-integer delayMs', () => {
    expect(updateSettingsRequestSchema.safeParse({ delayMs: 1.5 }).success).toBe(false);
  });
  it('accepts a digest-only body', () => {
    expect(updateSettingsRequestSchema.safeParse({ statsDigestEnabled: true }).success).toBe(true);
  });
  it('rejects a malformed digest time', () => {
    expect(updateSettingsRequestSchema.safeParse({ statsDigestTime: '9:00' }).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ statsDigestTime: '24:00' }).success).toBe(false);
  });
  it('rejects an out-of-range day of week', () => {
    expect(updateSettingsRequestSchema.safeParse({ statsDigestDayOfWeek: 7 }).success).toBe(false);
  });
  it('rejects an invalid time zone', () => {
    expect(
      updateSettingsRequestSchema.safeParse({ statsDigestTimezone: 'Not/AZone' }).success,
    ).toBe(false);
  });
});

describe('settingsDtoSchema', () => {
  it('fills digest defaults for an old payload without digest fields', () => {
    expect(settingsDtoSchema.parse({ delayMs: 8000, albumDebounceMs: 2000 })).toEqual({
      delayMs: 8000,
      albumDebounceMs: 2000,
      statsDigestEnabled: false,
      statsDigestFrequency: 'daily',
      statsDigestDayOfWeek: 1,
      statsDigestTime: '09:00',
      statsDigestTimezone: 'UTC',
    });
  });
  it('preserves explicit digest fields', () => {
    const parsed = settingsDtoSchema.parse({
      delayMs: 8000,
      albumDebounceMs: 2000,
      statsDigestEnabled: true,
      statsDigestFrequency: 'weekly',
      statsDigestDayOfWeek: 0,
      statsDigestTime: '23:30',
      statsDigestTimezone: 'America/New_York',
    });
    expect(parsed.statsDigestFrequency).toBe('weekly');
    expect(parsed.statsDigestTime).toBe('23:30');
  });
});

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
  });
  it('rejects nonsense', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('forwardLogQuerySchema', () => {
  it('applies defaults when both fields are absent', () => {
    expect(forwardLogQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });
  it('coerces string query values to numbers', () => {
    expect(forwardLogQuerySchema.parse({ limit: '10', offset: '20' })).toEqual({
      limit: 10,
      offset: 20,
    });
  });
  it('rejects negative offset', () => {
    expect(forwardLogQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
  it('rejects limit above 200', () => {
    expect(forwardLogQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });
  it('rejects limit of 0', () => {
    expect(forwardLogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});
