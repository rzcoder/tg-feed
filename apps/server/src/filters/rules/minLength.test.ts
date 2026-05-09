import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { minLengthRule } from './minLength.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('minLengthRule', () => {
  it('passes at the boundary (length === min)', () => {
    expect(minLengthRule.evaluate(ctx({ text: 'hello' }), { min: 5 })).toEqual({ pass: true });
  });

  it('passes above the boundary', () => {
    expect(minLengthRule.evaluate(ctx({ text: 'hello world' }), { min: 5 })).toEqual({
      pass: true,
    });
  });

  it('fails below the boundary', () => {
    const result = minLengthRule.evaluate(ctx({ text: 'hi' }), { min: 5 });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/length 2 below min 5/);
  });

  it('min=0 always passes (including empty text)', () => {
    expect(minLengthRule.evaluate(ctx({ text: '' }), { min: 0 })).toEqual({ pass: true });
    expect(minLengthRule.evaluate(ctx({ text: 'x' }), { min: 0 })).toEqual({ pass: true });
  });
});
