'use client';

import { createContext, useContext, useState, useCallback, useSyncExternalStore } from 'react';

type Theme = 'dark' | 'light';

const THEME_COLORS: Record<Theme, string> = {
  dark: '#0a0a0a',
  light: '#ffffff',
};

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
  /** Imperatively apply a theme (used when server-synced settings arrive). */
  setTheme: (theme: Theme) => void;
}>({ theme: 'dark', toggleTheme: () => {}, setTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function applyThemeColor(theme: Theme) {
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

function applyTheme(theme: Theme) {
  localStorage.setItem('jplrc-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeColor(theme);
}

function detectTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('jplrc-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const subscribeHydration = () => () => {};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [clientTheme, setThemeState] = useState<Theme>(detectTheme);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const theme = hydrated ? clientTheme : 'dark';

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
