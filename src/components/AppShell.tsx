'use client';

import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/lib/theme';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { Sun, Moon } from 'lucide-react';

function Nav() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  useEffect(() => {
    fetch('/api/spotify/status')
      .then(r => r.json())
      .then(data => {
        if (data.connected) {
          setSpotifyConnected(true);
          return fetch('/api/me').then(r => r.json());
        }
        return null;
      })
      .then(data => {
        if (data?.authenticated && data.isAdmin) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-[860px] items-center px-4 sm:px-6">
        <a href="/" className="whitespace-nowrap text-sm font-bold tracking-tight text-[var(--primary)]">
          {t('common.appName')}
        </a>
        <span className="ml-2.5 text-xs text-[var(--muted-foreground)] hidden sm:inline">
          {t('common.appDesc')}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="/"
            className="rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
          >
            {t('common.list')}
          </a>
          {spotifyConnected && isAdmin && (
            <a
              href="/admin"
              className="rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
            >
              {t('admin.title')}
            </a>
          )}
          <a
            href="https://github.com/GwoApps/jp-lyrics-app"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
            title="GitHub"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z"/></svg>
          </a>
          <LanguageSwitcher />
          <button
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
            title={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Nav />
        <main className="mx-auto max-w-[860px] px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
      </I18nProvider>
    </ThemeProvider>
  );
}
