import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { textRegexRule } from './textRegex.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('textRegexRule', () => {
  it('passes when pattern matches', () => {
    expect(
      textRegexRule.evaluate(ctx({ text: 'foo bar' }), { pattern: '^foo', flags: '' }),
    ).toEqual({ pass: true });
  });

  it('fails when pattern does not match', () => {
    const result = textRegexRule.evaluate(ctx({ text: 'bar foo' }), {
      pattern: '^foo',
      flags: '',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('^foo');
  });

  it('respects flags (case-insensitive match with i flag)', () => {
    expect(textRegexRule.evaluate(ctx({ text: 'FOO' }), { pattern: 'foo', flags: 'i' })).toEqual({
      pass: true,
    });
  });

  it('throws SyntaxError on invalid pattern (caught by evaluator, not rule)', () => {
    expect(() => textRegexRule.evaluate(ctx({ text: 'x' }), { pattern: '(', flags: '' })).toThrow(
      SyntaxError,
    );
  });
});
