import { sql } from 'drizzle-orm';

/**
 * The SQLite expression every `*_at` column writes (ISSUE #364).
 *
 * `datetime('now')` returns a bare `YYYY-MM-DD HH:MM:SS` wall clock with no
 * timezone marker; `'localtime'` then reinterprets it in the *writing process's*
 * zone — and no supported deployment sets `TZ`, so it silently meant UTC while
 * the browser read the bare string as local time. Writing an explicit UTC
 * instant with a trailing `Z` removes the guess entirely.
 *
 * Format matches `new Date().toISOString()` exactly (millisecond precision), so
 * SQL-written and JS-written timestamps are byte-comparable and sort correctly
 * as strings.
 */
export function nowUtcSql() {
  return sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
}

/** `nowUtcSql()` shifted by a SQLite modifier, e.g. `'-30 minutes'`. */
export function nowUtcOffsetSql(modifier: string) {
  return sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${modifier}))`;
}
