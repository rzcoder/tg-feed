// Only fires for waits above gramjs's floodSleepThreshold (default 60s); shorter ones auto-sleep inside the request.
// Name-based fallback because gramjs errors cross realm boundaries where instanceof fails.
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
