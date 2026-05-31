import { describe, it, expect } from 'vitest';
import { FloodWaitError, SlowModeWaitError, extractRateLimit } from './floodwait.js';

describe('extractRateLimit', () => {
  it('classifies a real FloodWaitError as flood_wait', () => {
    const err = new FloodWaitError({ request: undefined });
    // gramjs constructor sets `seconds` only if passed in args; ensure it's numeric for the guard.
    (err as { seconds: number }).seconds = 30;
    expect(extractRateLimit(err)).toEqual({ seconds: 30, kind: 'flood_wait' });
  });

  it('classifies a real SlowModeWaitError as slow_mode', () => {
    const err = new SlowModeWaitError({ request: undefined });
    (err as { seconds: number }).seconds = 90;
    expect(extractRateLimit(err)).toEqual({ seconds: 90, kind: 'slow_mode' });
  });

  it('classifies a structurally compatible FloodWaitError from another realm', () => {
    const FakeFloodWait = class FloodWaitError extends Error {
      seconds = 5;
    };
    expect(extractRateLimit(new FakeFloodWait('flood'))).toEqual({
      seconds: 5,
      kind: 'flood_wait',
    });
  });

  it('classifies a structurally compatible SlowModeWaitError from another realm', () => {
    const FakeSlowMode = class SlowModeWaitError extends Error {
      seconds = 12;
    };
    expect(extractRateLimit(new FakeSlowMode('slow'))).toEqual({
      seconds: 12,
      kind: 'slow_mode',
    });
  });

  it('returns null for a plain Error', () => {
    expect(extractRateLimit(new Error('boom'))).toBeNull();
  });

  it('returns null for non-error values', () => {
    expect(extractRateLimit(null)).toBeNull();
    expect(extractRateLimit(undefined)).toBeNull();
    expect(extractRateLimit('flood')).toBeNull();
    // bare object with seconds — must NOT be classified as a rate-limit error
    expect(extractRateLimit({ seconds: 5 })).toBeNull();
  });

  it('returns null when seconds is missing or non-numeric', () => {
    const NoSeconds = class FloodWaitError extends Error {};
    expect(extractRateLimit(new NoSeconds())).toBeNull();
    const BadSeconds = class FloodWaitError extends Error {
      seconds = 'abc' as unknown as number;
    };
    expect(extractRateLimit(new BadSeconds())).toBeNull();
  });
});
