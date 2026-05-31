/**
 * Single shared "now" tick.
 *
 * Components that render relative timestamps (e.g. "12s ago") subscribe via
 * `useNowTick()` and re-render only when the shared clock advances. The
 * interval is created lazily on the first subscriber and torn down when the
 * last one unsubscribes, so idle screens don't keep a timer alive.
 *
 * Using a module-scoped store rather than a per-component `setInterval`
 * avoids N identical timers when N rows are mounted, and lets a memoized
 * list parent skip re-rendering — only the leaf subscribers update.
 */
import { useSyncExternalStore } from 'react';

const TICK_MS = 5000;

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, TICK_MS);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureTimer();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
