import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../types.js';
import { textExcludesRule } from './textExcludes.js';

const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  text: '',
  hasMedia: false,
  ...overrides,
});

describe('textExcludesRule', () => {
  it('fails when text contains the excluded value (CI default)', () => {
    const result = textExcludesRule.evaluate(ctx({ text: 'Free crypto, click now' }), {
      value: 'crypto',
      caseInsensitive: true,
      includeEntities: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('crypto');
  });

  it('passes when text does not contain the value', () => {
    expect(
      textExcludesRule.evaluate(ctx({ text: 'rust news' }), {
        value: 'crypto',
        caseInsensitive: true,
        includeEntities: false,
      }),
    ).toEqual({ pass: true });
  });

  it('passes on empty text', () => {
    expect(
      textExcludesRule.evaluate(ctx({ text: '' }), {
        value: 'spam',
        caseInsensitive: true,
        includeEntities: false,
      }),
    ).toEqual({ pass: true });
  });

  it('case-sensitive: passes if cases differ', () => {
    expect(
      textExcludesRule.evaluate(ctx({ text: 'Crypto news' }), {
        value: 'crypto',
        caseInsensitive: false,
        includeEntities: false,
      }),
    ).toEqual({ pass: true });
  });

  it('ignores entity text when includeEntities is off', () => {
    expect(
      textExcludesRule.evaluate(
        ctx({ text: 'clean body', entityTexts: ['https://spam.example'] }),
        {
          value: 'spam.example',
          caseInsensitive: true,
          includeEntities: false,
        },
      ),
    ).toEqual({ pass: true });
  });

  it('fails when a hidden entity link contains the value and includeEntities is on', () => {
    const result = textExcludesRule.evaluate(
      ctx({ text: 'clean body', entityTexts: ['https://spam.example'] }),
      { value: 'spam.example', caseInsensitive: true, includeEntities: true },
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('spam.example');
  });
});
