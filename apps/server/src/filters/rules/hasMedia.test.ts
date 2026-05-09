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
});
