'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n, LOCALE_META, Locale } from '@/lib/i18n';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        title="Language"
      >
        {LOCALE_META[locale].label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg py-1 animate-[dialogIn_0.15s_ease-out]">
          {(Object.keys(LOCALE_META) as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                l === locale ? 'text-[var(--primary)] bg-[var(--accent)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              {LOCALE_META[l].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
