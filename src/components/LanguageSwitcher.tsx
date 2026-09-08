'use client';

import { useI18n, LOCALE_META, Locale } from '@/lib/i18n';
import { Languages, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        title={t('common.language')}
        aria-label={t('common.language')}
      >
        <Languages className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px] p-1">
        {(Object.keys(LOCALE_META) as Locale[]).map((l) => {
          const active = l === locale;
          const base = 'song-menu-item w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-left';
          const cls = active
            ? `${base} text-[var(--primary)] bg-[var(--accent)]`
            : `${base} text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]`;
          return (
            <DropdownMenuItem
              key={l}
              className={cls}
              onSelect={() => setLocale(l)}
            >
              <span className="min-w-0 flex-1">{LOCALE_META[l].label}</span>
              {active && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
