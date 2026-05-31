/**
 * Rate-limit detection for forward attempts.
 *
 * gramjs raises three closely-related errors that all carry a numeric
 * `seconds` field and all mean "wait this long before retrying":
 *
 *   - `FloodWaitError`     ← `FLOOD_WAIT_X` (and `FLOOD_PREMIUM_WAIT_X`,
 *                            mapped onto the same class by gramjs)
 *   - `SlowModeWaitError`  ← `SLOWMODE_WAIT_X` — destination chat has slow
 *                            mode enabled and we sent too soon
 *
 * The two are sibling subclasses of `FloodError`. Treating them as one
 * "rate-limit" outcome is correct because the retry logic is identical
 * (sleep `seconds` and retry the same job). We expose `kind` so the log /
 * event stream can distinguish them for diagnostics.
 *
 * gramjs also auto-sleeps any of these errors whose `seconds` is below
 * `floodSleepThreshold` (default 60 sec) inside the request itself — those
 * never reach this guard. This guard only fires for waits longer than the
 * threshold, which is the case worth treating specially.
 *
 * The structural fallback (match by class name) is needed because gramjs
 * errors can cross realm boundaries (workers, dynamic imports) where
 * `instanceof` fails.
 */
import { FloodWaitError, SlowModeWaitError } from 'telegram/errors/index.js';

export { FloodWaitError, SlowModeWaitError };

export type RateLimitKind = 'flood_wait' | 'slow_mode';

export interface RateLimitInfo {
  seconds: number;
  kind: RateLimitKind;
}

const KIND_BY_NAME: Record<string, RateLimitKind> = {
  FloodWaitError: 'flood_wait',
  SlowModeWaitError: 'slow_mode',
};

export function extractRateLimit(err: unknown): RateLimitInfo | null {
  if (err instanceof FloodWaitError) {
    return { seconds: err.seconds, kind: 'flood_wait' };
  }
  if (err instanceof SlowModeWaitError) {
    return { seconds: err.seconds, kind: 'slow_mode' };
  }
  if (typeof err !== 'object' || err === null) return null;
  const name = (err as { constructor?: { name?: string } }).constructor?.name;
  const kind = name ? KIND_BY_NAME[name] : undefined;
  if (!kind) return null;
  const seconds = (err as { seconds?: unknown }).seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return { seconds, kind };
}
