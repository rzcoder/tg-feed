import { describe, expect, it } from 'vitest';
import { ValidationError } from '../lib/errors.js';
import { assertFilterParamsCompilable } from './validateParams.js';

describe('assertFilterParamsCompilable', () => {
  it('accepts a valid text-regex pattern', () => {
    expect(() =>
      assertFilterParamsCompilable('text-regex', { pattern: 'foo', flags: 'i' }),
    ).not.toThrow();
  });

  it('rejects an uncompilable text-regex pattern with ValidationError', () => {
    expect(() => assertFilterParamsCompilable('text-regex', { pattern: '(', flags: '' })).toThrow(
      ValidationError,
    );
  });

  it('is a no-op for non-regex rule types', () => {
    expect(() => assertFilterParamsCompilable('text-contains', { value: 'x' })).not.toThrow();
  });
});
