// Theme preference (system/light/dark) → resolved theme on <html data-theme>; index.html resolves it pre-mount to avoid a flash, this hook keeps it in sync after.
import { useCallback, useEffect, useState } from 'react';
import { getTelegramColorScheme, isInsideTelegram } from './telegram';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tg-feed:theme';

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'] as const;

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (PREFERENCES as readonly string[]).includes(stored)) {
      return stored as ThemePreference;
    }
  } catch {
    // localStorage unavailable (e.g. private mode)
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  // Only trust Telegram's colorScheme when actually launched from Telegram; the SDK injects a 'light' default in plain browsers that would override the OS preference.
  if (isInsideTelegram()) {
    const tg = getTelegramColorScheme();
    if (tg) return tg;
  }
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

export interface UseThemeResult {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPreference()));

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  // Track the system media query only while preference is 'system'.
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setResolved(resolve(next));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return { preference, resolved, setPreference };
}
