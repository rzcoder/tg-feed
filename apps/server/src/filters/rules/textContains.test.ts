import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { textContainsRule } from './textContains.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('textContainsRule', () => {
  it('passes when text contains value (case-insensitive default)', () => {
    expect(
      textContainsRule.evaluate(ctx({ text: 'Rust is great' }), {
        value: 'rust',
        caseInsensitive: true,
      }),
    ).toEqual({ pass: true });
  });

  it('case-sensitive miss when caseInsensitive=false', () => {
    const result = textContainsRule.evaluate(ctx({ text: 'Rust' }), {
      value: 'rust',
      caseInsensitive: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('rust');
  });

  it('case-sensitive match when caseInsensitive=false', () => {
    expect(
      textContainsRule.evaluate(ctx({ text: 'Rust' }), {
        value: 'Rust',
        caseInsensitive: false,
      }),
    ).toEqual({ pass: true });
  });

  it('fails on empty text', () => {
    const result = textContainsRule.evaluate(ctx({ text: '' }), {
      value: 'foo',
      caseInsensitive: true,
    });
    expect(result.pass).toBe(false);
  });
});
