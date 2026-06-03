import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { getCompiledRegex, textRegexRule } from './textRegex.js';

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

  it('throws on invalid pattern (caught by evaluator, not rule)', () => {
    expect(() => textRegexRule.evaluate(ctx({ text: 'x' }), { pattern: '(', flags: '' })).toThrow();
  });

  it('memoizes compiled RE2 instances by pattern+flags', () => {
    const a = getCompiledRegex('foo', 'i');
    expect(getCompiledRegex('foo', 'i')).toBe(a);
    expect(getCompiledRegex('foo', '')).not.toBe(a);
  });

  it('does not catastrophically backtrack on pathological pattern (RE2 is linear-time)', () => {
    // (a+)+$ on a long run of `a` followed by `b` is the textbook ReDoS case
    // for native RegExp — exponential backtracking. RE2 finishes in linear time.
    const text = 'a'.repeat(40) + 'b';
    const start = Date.now();
    const result = textRegexRule.evaluate(ctx({ text }), { pattern: '(a+)+$', flags: '' });
    const elapsed = Date.now() - start;
    expect(result.pass).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});
