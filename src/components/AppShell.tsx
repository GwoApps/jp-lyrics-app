'use client';

import { I18nProvider, useI18n } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/lib/theme';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { Sun, Moon } from 'lucide-react';

function Nav() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
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
          <a
            href="/songs/new"
            className="rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
          >
            {t('common.new')}
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
