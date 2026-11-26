/**
 * Per-target-language translation caches (ISSUE #485).
 *
 * The legacy `songs.lyrics_translation` columns keep holding the cache for the
 * *effective* language so every existing reader stays correct, while
 * `song_translations` owns one row per (song, language). This module makes the
 * new table appear on every backend — including Cloudflare D1, which never
 * runs the Node startup migrator — and keeps the two views in sync.
 *
 * `ensureSongTranslations()` is idempotent and memoised per process/isolate.
 * A failure clears the memo so the next request retries instead of leaving the
 * app permanently without the table.
 */

import { sql } from 'drizzle-orm';
import { nowUtcSql } from './db-time-sql.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle DB is typed `any` by design (lib/db.ts). */

export interface StoredSongTranslation {
  lines: string;
  reasoning: string | null;
}

const readyByDb = new WeakMap<object, Promise<void>>();

function dbKey(db: any): object {
  // Drizzle wraps the client; the underlying client is stable per DB instance.
  return (db?.$client as object) ?? (db as object);
}

async function createAndBackfill(db: any): Promise<void> {
  await db.run(sql.raw(`
    CREATE TABLE IF NOT EXISTS song_translations (
      song_id text NOT NULL REFERENCES songs(id) ON DELETE cascade,
      lang text NOT NULL,
      lines text NOT NULL DEFAULT '[]',
      reasoning text,
      updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (song_id, lang)
    )
  `));
  // Seed from the legacy single cache. Rows already present are never
  // overwritten: the new table is authoritative once a language has been
  // written through it, and a stale mirror must not clobber newer output.
  await db.run(sql.raw(`
    INSERT INTO song_translations (song_id, lang, lines, reasoning, updated_at)
    SELECT s.id,
           COALESCE(NULLIF(TRIM(s.lyrics_translation_lang), ''), 'zh-CN'),
           s.lyrics_translation,
           s.lyrics_translation_reasoning,
           s.updated_at
    FROM songs s
    WHERE s.lyrics_translation IS NOT NULL
      AND s.lyrics_translation <> ''
      AND s.lyrics_translation <> '[]'
      AND NOT EXISTS (
        SELECT 1 FROM song_translations t
        WHERE t.song_id = s.id
          AND t.lang = COALESCE(NULLIF(TRIM(s.lyrics_translation_lang), ''), 'zh-CN')
      )
  `));
}

/** Create the table and seed legacy rows once per process/isolate. */
export function ensureSongTranslations(db: any): Promise<void> {
  const key = dbKey(db);
  let ready = readyByDb.get(key);
  if (!ready) {
    ready = createAndBackfill(db).catch((error: unknown) => {
      readyByDb.delete(key);
      throw error;
    });
    readyByDb.set(key, ready);
  }
  return ready;
}

function normalizeLang(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Read the cache for one language, falling back to the legacy columns when no
 * row exists yet (first request after an upgrade where the backfill has not
 * run, or a language written before the table was introduced).
 */
export async function readSongTranslation(
  db: any,
  songId: string,
  lang: string,
  legacy: {
    lyrics_translation?: string | null;
    lyrics_translation_lang?: string | null;
    lyrics_translation_reasoning?: string | null;
  },
): Promise<StoredSongTranslation | null> {
  await ensureSongTranslations(db);
  const rows = await db.all(sql`
    SELECT lines, reasoning FROM song_translations
    WHERE song_id = ${songId} AND lang = ${lang}
  `) as StoredSongTranslation[];
  if (rows.length > 0) {
    return { lines: rows[0].lines, reasoning: rows[0].reasoning ?? null };
  }
  const storedLang = normalizeLang(legacy.lyrics_translation_lang);
  const legacyLines = legacy.lyrics_translation;
  // An unrecorded legacy stamp predates the language column; treat it as the
  // default display language, matching the migration's seed rule.
  const legacyEffective = storedLang || 'zh-CN';
  if (legacyLines && legacyLines !== '[]' && legacyEffective === lang) {
    return { lines: legacyLines, reasoning: legacy.lyrics_translation_reasoning ?? null };
  }
  return null;
}

/** All languages with a stored cache, newest first. */
export async function listSongTranslationLangs(
  db: any,
  songId: string,
  legacy?: { lyrics_translation?: string | null; lyrics_translation_lang?: string | null },
): Promise<string[]> {
  await ensureSongTranslations(db);
  const rows = await db.all(sql`
    SELECT lang FROM song_translations WHERE song_id = ${songId} ORDER BY updated_at DESC
  `) as { lang: string }[];
  const langs = rows.map((row) => row.lang).filter(Boolean);
  const legacyLang = normalizeLang(legacy?.lyrics_translation_lang);
  if (legacy?.lyrics_translation && legacy.lyrics_translation !== '[]'
    && legacyLang && !langs.includes(legacyLang)) {
    langs.push(legacyLang);
  }
  return langs;
}

/** Upsert one language's cache after its legacy mirror has been committed. */
export async function writeSongTranslation(
  db: any,
  opts: { songId: string; lang: string; lines: string; reasoning?: string | null },
): Promise<void> {
  await ensureSongTranslations(db);
  // `reasoning: undefined` means "leave the stored reasoning alone" (a plain
  // cache merge that happens before the separate reasoning write); `null`
  // means "this save cleared it" (a manual correction).
  const reasoning = opts.reasoning;
  const reasoningSql = reasoning === undefined ? sql`NULL` : sql`${reasoning ?? null}`;
  await db.run(sql`
    INSERT INTO song_translations (song_id, lang, lines, reasoning, updated_at)
    VALUES (${opts.songId}, ${opts.lang}, ${opts.lines}, ${reasoningSql}, ${nowUtcSql()})
    ON CONFLICT(song_id, lang) DO UPDATE SET
      lines = excluded.lines,
      reasoning = CASE WHEN ${reasoning === undefined} THEN song_translations.reasoning
                       ELSE excluded.reasoning END,
      updated_at = excluded.updated_at
  `);
}

/** Clear every language's cache when the source lyrics change. */
export async function clearSongTranslations(db: any, songId: string): Promise<void> {
  await ensureSongTranslations(db);
  await db.run(sql`DELETE FROM song_translations WHERE song_id = ${songId}`);
}
