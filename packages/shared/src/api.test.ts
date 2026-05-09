import { describe, expect, it } from 'vitest';
import {
  createSubscriptionFilterRequestSchema,
  createSubscriptionRequestSchema,
  forwardLogQuerySchema,
  loginRequestSchema,
  updateSettingsRequestSchema,
  updateSubscriptionFilterRequestSchema,
  updateSubscriptionRequestSchema,
} from './api.js';

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
      destinationChatId: '-100456',
    });
    expect(result.sourceChatId).toBe('-100123');
    expect(result.enabled).toBeUndefined();
  });
  it('accepts explicit enabled', () => {
    const result = createSubscriptionRequestSchema.parse({
      sourceChatId: '-100123',
      sourceTitle: 'src',
      destinationChatId: '-100456',
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });
  it('rejects missing sourceChatId', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceTitle: 'src',
        destinationChatId: '-100456',
      }).success,
    ).toBe(false);
  });
  it('rejects empty string fields', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        sourceChatId: '',
        sourceTitle: 'src',
        destinationChatId: '-100456',
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
