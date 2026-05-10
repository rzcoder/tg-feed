import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, useTheme } from './useTheme';

interface MockMq {
  matches: boolean;
  media: string;
  listeners: Set<(e: MediaQueryListEvent) => void>;
  addEventListener: (t: string, l: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (t: string, l: (e: MediaQueryListEvent) => void) => void;
}

function installMatchMedia(initialDark: boolean): { mq: MockMq; flip: (toDark: boolean) => void } {
  const mq: MockMq = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    listeners: new Set(),
    addEventListener: (_t, l) => mq.listeners.add(l),
    removeEventListener: (_t, l) => mq.listeners.delete(l),
  };
  window.matchMedia = vi.fn().mockReturnValue(mq);
  return {
    mq,
    flip: (toDark: boolean) => {
      mq.matches = toDark;
      // Dispatch a synthetic event-like object — handlers only read `.matches`
      // off the queried mq inside the hook (via `systemTheme()`).
      mq.listeners.forEach((l) => l({ matches: toDark } as MediaQueryListEvent));
    },
  };
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to system preference and resolves via prefers-color-scheme', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves to light when system preference is light', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('reads stored preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it('overriding to light/dark wins over system and persists', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(result.current.preference).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('media-query change propagates only while preference is system', () => {
    const { flip } = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    // OS flips → resolved follows because preference is 'system'.
    act(() => flip(true));
    expect(result.current.resolved).toBe('dark');

    // User overrides to 'light' → OS flips ignored.
    act(() => result.current.setPreference('light'));
    expect(result.current.resolved).toBe('light');
    act(() => flip(false));
    expect(result.current.resolved).toBe('light');
  });

  it('switching back to system re-resolves against current OS preference', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(result.current.resolved).toBe('light');
    act(() => result.current.setPreference('system'));
    expect(result.current.resolved).toBe('dark');
  });
});
