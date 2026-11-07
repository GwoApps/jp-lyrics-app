/**
 * Pure content-equality helpers shared by the lyrics write paths (issue #304).
 *
 * Zero imports on purpose: these must stay usable from tests that cannot boot a
 * database. `sync-service.ts` transitively imports `lib/db`, so a unit test
 * aimed at these two-line predicates must not pull it in.
 */

/**
 * Normalize every line terminator to `\n` (LF).
 *
 * Providers ship CRLF / CR payloads (an admin HTTP provider's JSON is passed
 * through verbatim, several upstreams answer with `\r\n`), while
 * `lyrics_raw` is read back with a plain `split('\n')` by furigana validation,
 * translation indexing, export and the client. Folding at the edge keeps one
 * single line model for everything downstream.
 */
export function normalizeLyricsEol(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Plain + synced lyrics as they must be written to the database. */
export interface NormalizedSyncContent {
  plain: string;
  synced: string;
}

/**
 * Fold a candidate into the exact values the sync write persists.
 *
 * Routes every lyric write through one place so "what we compare" and "what we
 * store" cannot drift apart again (issue #304): the change check runs on
 * `plain`, and `plain` is what lands in `lyrics_raw`.
 */
export function normalizeSyncContent(candidate: { plain: string; synced: string }): NormalizedSyncContent {
  return {
    plain: normalizeLyricsEol(candidate.plain),
    synced: normalizeLyricsEol(candidate.synced),
  };
}

/**
 * Decide whether writing `candidatePlain` would change the stored lyrics.
 *
 * The derived caches (furigana / translation / glossary / reading scheme
 * confirmation) are all indexed by `lyrics_raw` LINE NUMBER, so they may only
 * survive a write when the new text is line-for-line identical to what is
 * already stored. That is why this is a whole-document comparison and not the
 * lenient "text lines only" view (`getLrcTextLines`).
 *
 * The comparison is deliberately asymmetric:
 *
 *  - the candidate is folded to LF, because that folded value is exactly what
 *    the write persists;
 *  - the stored value is compared verbatim, because that is what the caches
 *    were derived from (readers never fold it — a legacy CRLF row is split on
 *    `\n`, so its rows still end with `\r`).
 *
 * So "unchanged" means "the bytes we would write are the bytes already there",
 * which is the only condition under which the caches stay valid. A stored
 * document that still carries CRLF therefore reports `true` on re-sync: writing
 * it back as LF genuinely re-shapes every row, and keeping the old caches would
 * leave them misaligned (`furigana_source_mismatch` all over again). A plain
 * LF-stored song whose provider now answers CRLF reports `false` — the written
 * bytes are unchanged, so nothing is lost.
 */
export function hasLyricsContentChanged(storedRaw: string, candidatePlain: string): boolean {
  return normalizeLyricsEol(candidatePlain) !== storedRaw;
}

/** True when a stored JSON column holds at least one entry ('' and '[]' do not). */
function hasJsonEntries(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== '[]';
}

/**
 * Whether the song actually holds derived caches that a content-changing write
 * would destroy. Used to tell the user their furigana / translation were reset,
 * instead of silently dropping work (`{ lyricsFurigana, lyricsTranslation,
 * lyricsGlossary }` are the raw DB columns).
 */
export function hasDerivedLyricsCaches(input: {
  furigana?: string | null;
  translation?: string | null;
  glossary?: string | null;
}): boolean {
  return hasJsonEntries(input.furigana)
    || hasJsonEntries(input.translation)
    || hasJsonEntries(input.glossary);
}
