import { or, sql } from 'drizzle-orm';
import type { CoverPaletteJson } from '@/lib/types';
import { resolveLrcTextUpdate } from '@/lib/lrc';

/**
 * Build the minimal UPDATE set for a songs PUT (issue #211).
 *
 * Only fields present in the payload are written, plus derived-invalidation
 * columns whose value depends on the DB's *current* state via SQL CASE at
 * write time (never a stale request-time snapshot). Two concurrent PUTs
 * touching different fields therefore never overwrite each other.
 */
export function buildSongUpdateSet(
  existing: { lyrics_raw: string; lyrics_synced: string },
  body: {
    title?: string;
    artist?: string;
    cover_palette?: CoverPaletteJson | null;
    reading_scheme?: string;
    reading_scheme_confirmed?: boolean;
    lyrics_raw?: string;
    lyrics_synced?: string;
    clear_furigana?: boolean;
    clear_translation?: boolean;
    clear_reasoning?: boolean;
    clear_glossary?: boolean;
  },
): Record<string, unknown> {
  const { title, artist, cover_palette, reading_scheme, reading_scheme_confirmed, lyrics_raw, lyrics_synced, clear_furigana, clear_translation, clear_reasoning, clear_glossary } = body;
  const set: Record<string, unknown> = {};

  // --- Independent fields: write only when present in the payload ---
  if (title !== undefined) set.title = title;
  if (artist !== undefined) set.artist = artist;
  if (cover_palette !== undefined) {
    set.coverPalette = cover_palette === null ? null : JSON.stringify(cover_palette);
  }
  if (reading_scheme !== undefined) set.readingScheme = reading_scheme;
  if (reading_scheme_confirmed !== undefined) {
    set.readingSchemeConfirmed = Number(reading_scheme_confirmed);
  }

  // --- Lyrics fields ---
  const hasRaw = lyrics_raw !== undefined;
  const hasSynced = lyrics_synced !== undefined;

  // Determine the effective new lyrics_raw (if any). For `lyrics_synced`,
  // resolve whether its text content differs from the current plain lyrics —
  // timestamp-only edits must not rewrite plain lyrics.
  let effectiveNewRaw: string | undefined;
  if (hasRaw) {
    effectiveNewRaw = lyrics_raw;
  } else if (hasSynced) {
    const update = resolveLrcTextUpdate(existing.lyrics_raw, existing.lyrics_synced, lyrics_synced);
    if (update.contentChanged) {
      effectiveNewRaw = update.lyricsRaw;
    }
  }

  if (effectiveNewRaw !== undefined) set.lyricsRaw = effectiveNewRaw;
  if (hasSynced) set.lyricsSynced = lyrics_synced;


  // --- Cross-field derived invalidation (SQL CASE against current DB values) ---
  // Each CASE compares the submitted value against the live column at write
  // time. If another request already updated the column, the comparison uses
  // the winner's value — never the stale request-time snapshot.

  // Furigana: cleared when lyrics_raw changes, reading_scheme changes, or
  // explicitly requested via clear_furigana.
  if (clear_furigana === true) {
    set.lyricsFurigana = '[]';
  } else if (effectiveNewRaw !== undefined || reading_scheme !== undefined) {
    const conds: unknown[] = [];
    if (effectiveNewRaw !== undefined) conds.push(sql`${effectiveNewRaw} != lyrics_raw`);
    if (reading_scheme !== undefined) conds.push(sql`${reading_scheme} != reading_scheme`);
    const cond = conds.length === 1 ? conds[0] : or(...conds as Parameters<typeof or>);
    set.lyricsFurigana = sql`CASE WHEN ${cond} THEN '[]' ELSE lyrics_furigana END`;
  }

  // Translation cache + language stamp: invalidated when lyrics content
  // changes or explicitly via clear_translation.
  if (clear_translation === true) {
    set.lyricsTranslation = '[]';
    set.lyricsTranslationLang = null;
  } else if (effectiveNewRaw !== undefined) {
    const cond = sql`${effectiveNewRaw} != lyrics_raw`;
    set.lyricsTranslation = sql`CASE WHEN ${cond} THEN '[]' ELSE lyrics_translation END`;
    set.lyricsTranslationLang = sql`CASE WHEN ${cond} THEN NULL ELSE lyrics_translation_lang END`;
  }

  // Reasoning: wiped when translation is cleared, lyrics content changes, or
  // explicitly via clear_reasoning.
  if (clear_translation === true || clear_reasoning === true) {
    set.lyricsTranslationReasoning = null;
  } else if (effectiveNewRaw !== undefined) {
    set.lyricsTranslationReasoning = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_translation_reasoning END`;
  }

  // Glossary: invalidated when lyrics content changes or explicitly via
  // clear_glossary.
  if (clear_glossary === true) {
    set.lyricsGlossary = null;
  } else if (effectiveNewRaw !== undefined) {
    set.lyricsGlossary = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_glossary END`;
  }

  // reading_scheme_confirmed auto-reset: when lyrics content changes and the
  // active scheme is 'ja-kana', reset the flag (old reading is no longer
  // accurate for the new text). When reading_scheme is submitted in the
  // payload, compare against that submitted value; otherwise reference the
  // DB's current reading_scheme column at write time — never a stale
  // request-time snapshot.
  if (reading_scheme_confirmed === undefined && effectiveNewRaw !== undefined) {
    const schemeCond = reading_scheme !== undefined
      ? sql`${reading_scheme} = 'ja-kana'`
      : sql`reading_scheme = 'ja-kana'`;
    set.readingSchemeConfirmed = sql`CASE
      WHEN ${effectiveNewRaw} != lyrics_raw AND ${schemeCond}
      THEN 0 ELSE reading_scheme_confirmed END`;
  }

  // Metadata when lyrics content actually changes: mark as manual edit, full
  // confidence, needs-review cleared, and drop the fetched-at stamp.
  if (effectiveNewRaw !== undefined) {
    set.lyricsSource = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 'manual' ELSE lyrics_source END`;
    set.lyricsConfidence = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 100 ELSE lyrics_confidence END`;
    set.lyricsNeedsReview = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 0 ELSE lyrics_needs_review END`;
    set.lyricsFetchedAt = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_fetched_at END`;
  }

  // Always bump the timestamp on any successful write.
  set.updatedAt = sql`(datetime('now', 'localtime'))`;

  return set;
}
