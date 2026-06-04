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
        includeEntities: false,
      }),
    ).toEqual({ pass: true });
  });

  it('case-sensitive miss when caseInsensitive=false', () => {
    const result = textContainsRule.evaluate(ctx({ text: 'Rust' }), {
      value: 'rust',
      caseInsensitive: false,
      includeEntities: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('rust');
  });

  it('case-sensitive match when caseInsensitive=false', () => {
    expect(
      textContainsRule.evaluate(ctx({ text: 'Rust' }), {
        value: 'Rust',
        caseInsensitive: false,
        includeEntities: false,
      }),
    ).toEqual({ pass: true });
  });

  it('fails on empty text', () => {
    const result = textContainsRule.evaluate(ctx({ text: '' }), {
      value: 'foo',
      caseInsensitive: true,
      includeEntities: false,
    });
    expect(result.pass).toBe(false);
  });

  it('does NOT match entity text when includeEntities is off (default behavior)', () => {
    const result = textContainsRule.evaluate(
      ctx({ text: 'click here', entityTexts: ['https://example.com'] }),
      { value: 'example.com', caseInsensitive: true, includeEntities: false },
    );
    expect(result.pass).toBe(false);
  });

  it('matches hidden entity text when includeEntities is on', () => {
    expect(
      textContainsRule.evaluate(ctx({ text: 'click here', entityTexts: ['https://example.com'] }), {
        value: 'example.com',
        caseInsensitive: true,
        includeEntities: true,
      }),
    ).toEqual({ pass: true });
  });

  it('includeEntities with no entity texts behaves like body-only (no throw)', () => {
    const result = textContainsRule.evaluate(ctx({ text: 'plain body' }), {
      value: 'missing',
      caseInsensitive: true,
      includeEntities: true,
    });
    expect(result.pass).toBe(false);
  });
});
