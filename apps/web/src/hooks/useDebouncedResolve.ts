import { useEffect } from 'react';

export interface UseDebouncedResolveOptions {
  /** Current input value to resolve. */
  value: string;
  /** When false the hook is inert (e.g. edit mode, where the source is fixed). */
  enabled: boolean;
  /** Called with the trimmed input once the debounce settles. */
  mutate: (input: string) => void;
  /** Called to clear any prior result when the input is too short. */
  reset: () => void;
  /** Minimum trimmed length before a resolve is attempted. */
  minLength?: number;
  /** Debounce delay in ms after the last change. */
  delayMs?: number;
}

/**
 * Debounced channel/chat resolution shared by SubSheet and DestSheet. Fires
 * `mutate(trimmed)` `delayMs` after the last change to `value`, but only while
 * `enabled` and the trimmed input is long enough to plausibly be a Telegram
 * link / @username / chat id. Clears any prior result when it's too short.
 */
export function useDebouncedResolve({
  value,
  enabled,
  mutate,
  reset,
  minLength = 4,
  delayMs = 600,
}: UseDebouncedResolveOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const trimmed = value.trim();
    if (trimmed.length < minLength) {
      reset();
      return;
    }
    const t = setTimeout(() => mutate(trimmed), delayMs);
    return () => clearTimeout(t);
  }, [value, enabled, mutate, reset, minLength, delayMs]);
}
