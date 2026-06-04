import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { hasMediaRule } from './hasMedia.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('hasMediaRule', () => {
  it('required=true passes when media present', () => {
    expect(hasMediaRule.evaluate(ctx({ hasMedia: true }), { required: true })).toEqual({
      pass: true,
    });
  });

  it('required=true fails when media absent', () => {
    const result = hasMediaRule.evaluate(ctx({ hasMedia: false }), { required: true });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no media/);
  });

  it('required=false passes when media absent', () => {
    expect(hasMediaRule.evaluate(ctx({ hasMedia: false }), { required: false })).toEqual({
      pass: true,
    });
  });

  it('required=false fails when media present', () => {
    const result = hasMediaRule.evaluate(ctx({ hasMedia: true }), { required: false });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/media present/);
  });

  it('countOp "gt" passes when media count exceeds the threshold', () => {
    expect(
      hasMediaRule.evaluate(ctx({ hasMedia: true, mediaCount: 4 }), {
        required: true,
        countOp: 'gt',
        count: 3,
      }),
    ).toEqual({ pass: true });
  });

  it('countOp "gt" fails when media count does not exceed the threshold', () => {
    const result = hasMediaRule.evaluate(ctx({ hasMedia: true, mediaCount: 1 }), {
      required: true,
      countOp: 'gt',
      count: 1,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/media count 1 not > 1/);
  });

  it('countOp "lt" passes when media count is below the threshold', () => {
    expect(
      hasMediaRule.evaluate(ctx({ hasMedia: true, mediaCount: 1 }), {
        required: true,
        countOp: 'lt',
        count: 3,
      }),
    ).toEqual({ pass: true });
  });

  it('countOp "lt" fails when media count meets or exceeds the threshold', () => {
    const result = hasMediaRule.evaluate(ctx({ hasMedia: true, mediaCount: 5 }), {
      required: true,
      countOp: 'lt',
      count: 5,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/media count 5 not < 5/);
  });

  it('falls back to a count of 1 when mediaCount is absent from the context', () => {
    expect(
      hasMediaRule.evaluate(ctx({ hasMedia: true }), { required: true, countOp: 'lt', count: 2 }),
    ).toEqual({ pass: true });
    expect(
      hasMediaRule.evaluate(ctx({ hasMedia: true }), { required: true, countOp: 'gt', count: 1 })
        .pass,
    ).toBe(false);
  });

  it('checks media presence before the count comparison', () => {
    const result = hasMediaRule.evaluate(ctx({ hasMedia: false, mediaCount: 0 }), {
      required: true,
      countOp: 'gt',
      count: 1,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no media/);
  });
});
