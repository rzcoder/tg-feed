/**
 * FloodWait detection.
 *
 * gramjs throws `FloodWaitError` (subclass of `FloodError`) with a `seconds`
 * field when Telegram throttles us. We re-export it as a named symbol and
 * provide a structural type guard so callers don't need to import the gramjs
 * class everywhere — and so tests can synthesise a flood-wait without
 * constructing the real error.
 */
import { FloodWaitError } from 'telegram/errors/index.js';

export { FloodWaitError };

export interface FloodWaitLike {
  seconds: number;
}

export function isFloodWaitError(err: unknown): err is FloodWaitLike {
  if (err instanceof FloodWaitError) return true;
  // Structural fallback — gramjs ships errors that may cross realm boundaries
  // (workers, dynamic imports). Match by class name + numeric `seconds`.
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { constructor?: { name?: string } }).constructor?.name;
  if (name !== 'FloodWaitError') return false;
  const seconds = (err as { seconds?: unknown }).seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds);
}
