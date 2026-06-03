// One shared clock for all relative timestamps; lazy timer avoids N per-row intervals.
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
