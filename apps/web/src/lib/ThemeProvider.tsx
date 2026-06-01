import { createContext, useContext, type ReactNode } from 'react';
import { useTheme, type UseThemeResult } from './useTheme';

const ThemeContext = createContext<UseThemeResult | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Hosts a single theme instance at the app root so the resolved theme is
 * applied (and system changes are tracked) for the whole session — not just
 * while a particular page that happens to read the theme is mounted.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useTheme();
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): UseThemeResult {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within a ThemeProvider');
  return ctx;
}
