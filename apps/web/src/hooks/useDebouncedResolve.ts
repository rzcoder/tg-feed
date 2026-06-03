import { useEffect } from 'react';

export interface UseDebouncedResolveOptions {
  value: string;
  // When false the hook is inert (e.g. edit mode, where the source is fixed).
  enabled: boolean;
  mutate: (input: string) => void;
  reset: () => void;
  minLength?: number;
  delayMs?: number;
}

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
