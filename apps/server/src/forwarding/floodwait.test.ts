import { describe, it, expect } from 'vitest';
import { FloodWaitError, isFloodWaitError } from './floodwait.js';

describe('isFloodWaitError', () => {
  it('returns true for a real FloodWaitError', () => {
    const err = new FloodWaitError({ request: undefined });
    // gramjs constructor sets `seconds` only if passed in args; ensure it's numeric for the guard.
    (err as { seconds: number }).seconds = 30;
    expect(isFloodWaitError(err)).toBe(true);
  });

  it('returns true for a structurally compatible error from another realm', () => {
    const FakeFloodWait = class FloodWaitError extends Error {
      seconds = 5;
    };
    expect(isFloodWaitError(new FakeFloodWait('flood'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isFloodWaitError(new Error('boom'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isFloodWaitError(null)).toBe(false);
    expect(isFloodWaitError(undefined)).toBe(false);
    expect(isFloodWaitError('flood')).toBe(false);
    expect(isFloodWaitError({ seconds: 5 })).toBe(false);
  });
});
