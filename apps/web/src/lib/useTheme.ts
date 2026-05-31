/**
 * Theme: System / Light / Dark.
 *
 * The user's *preference* is one of three; the *resolved* theme is one of
 * two ('light' | 'dark') and is what gets written to `<html data-theme>`.
 * When preference is 'system', resolved tracks `prefers-color-scheme` live.
 *
 * Initial resolution happens in an inline script in `index.html` before
 * React mounts (avoids flash-of-wrong-theme). This hook keeps the runtime
 * value in sync with React state and re-applies on changes.
 */
import { useCallback, useEffect, useState } from 'react';
import { getTelegramColorScheme } from './telegram';

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
    // localStorage unavailable (e.g., private mode in some browsers).
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  // Inside Telegram, follow Telegram's color scheme; elsewhere the OS preference.
  const tg = getTelegramColorScheme();
  if (tg) return tg;
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

  // Apply resolved theme any time it changes.
  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  // Watch the system media query, but only react while preference is 'system'.
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
      // ignore
    }
  }, []);

  return { preference, resolved, setPreference };
}
