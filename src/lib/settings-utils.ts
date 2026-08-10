/**
 * Client-safe helpers for personal settings.
 *
 * This module must stay free of any server-only imports (no `./db`) so the
 * `/settings` page (a client component) can import it in the browser bundle.
 * The server-side `./user-settings` module re-exports these so both sides
 * share one source of truth for value normalization.
 */

export function normalizeTheme(v: string | undefined): 'dark' | 'light' {
  return v === 'light' ? 'light' : 'dark';
}

export function normalizeReadingMode(v: string | undefined): 'original' | 'furigana' {
  return v === 'original' ? 'original' : 'furigana';
}

export function normalizeBoolean(v: string | undefined): boolean {
  return v === 'true';
}

export function normalizeFontSize(v: string | undefined): number {
  if (!v) return 20;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 20;
  return Math.min(32, Math.max(14, n));
}

export function normalizeLocale(v: string | undefined): string {
  const locales = ['ja', 'en', 'zh-CN', 'zh-TW'];
  return v && locales.includes(v) ? v : 'zh-CN';
}
