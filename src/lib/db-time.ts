/**
 * One parsing entry point for every `*_at` value the database hands to the UI
 * (ISSUE #364).
 *
 * Columns store an absolute UTC instant. Two shapes are accepted because both
 * exist in real databases:
 *
 *  - `2026-09-26T12:00:00.000Z` — what `nowUtcSql()` / `new Date().toISOString()`
 *    write today;
 *  - `2026-09-26 12:00:00` — the bare wall-clock string older rows carry. Those
 *    came from SQLite's `datetime('now','localtime')`, and no supported
 *    deployment sets `TZ` (node:22-alpine runner, compose services,
 *    Workers/D1), so `localtime` *was* UTC: reading it as UTC is the only
 *    interpretation that matches what was actually stored.
 *
 * A value that already carries `Z` or an offset is used as-is — never shifted
 * twice. Formatting then happens in the visitor's own time zone, which is the
 * intent of every call site (`bcp47` / `locale` argument).
 */

const NAIVE = /^(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?))?$/;

export function parseDbTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const naive = NAIVE.exec(trimmed);
  // A bare date is a calendar day, not an instant: anchoring it to UTC midnight
  // keeps it on the same day in every zone west of UTC+12.
  const iso = naive ? `${naive[1]}T${naive[2] ?? '00:00:00'}.000Z` : trimmed;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Date + time in the visitor's time zone; `null` when the value is unusable. */
export function formatDbDateTime(
  value: string | null | undefined,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string | null {
  const date = parseDbTimestamp(value);
  return date ? date.toLocaleString(locale, options) : null;
}

/** Calendar day in the visitor's time zone; `null` when the value is unusable. */
export function formatDbDate(
  value: string | null | undefined,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string | null {
  const date = parseDbTimestamp(value);
  return date ? date.toLocaleDateString(locale, { dateStyle: 'medium', ...options }) : null;
}
