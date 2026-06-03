import { createContext, useContext, type ReactNode } from 'react';
import { useTheme, type UseThemeResult } from './useTheme';

const ThemeContext = createContext<UseThemeResult | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
}

// Hosts one theme instance at the app root so it tracks system changes for the whole session, not per-page.
export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useTheme();
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): UseThemeResult {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within a ThemeProvider');
  return ctx;
}
