import { foldKatakanaToHiragana } from './japanese-fold.ts';
import { parseTranslationCache } from './translation/parse.ts';
import { romanizeLyricsReading } from './romaji.ts';
import type { FuriganaLine } from './types.ts';

/**
 * Fold a string for *search comparison only* (ISSUE #426).
 *
 * Three transforms, because each one is a real thing people type into a
 * Japanese song library:
 *
 * - `NFKC` — width/compatibility forms. A Japanese IME in direct-input mode
 *   produces full-width latin (`ｓｅａｇｌａｓｓ`), and half-width katakana
 *   (`ｻﾖﾅﾗ`) must reach the full-width block before folding can see it.
 * - `foldKatakanaToHiragana` — the same reading is written in two scripts
 *   (「サヨナラ」/「さよなら」). Folding both sides onto hiragana makes them equal.
 * - lowercase — `SEAGLASS` / `Dive iN`.
 *
 * Whitespace is collapsed but *kept*: callers split on it and AND the terms, so
 * 「さよなら キス」 narrows the result instead of matching nothing.
 *
 * Never render the result and never send it to a lyric source — hand the
 * original text to the UI and to any API.
 */
export function normalizeSearchText(value: string): string {
  return foldKatakanaToHiragana(value.normalize('NFKC'))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a raw query into normalized terms; `[]` means "no query". */
export function searchTerms(query: string): string[] {
  return normalizeSearchText(query).split(' ').filter(Boolean);
}

/**
 * Readable lyric text appended to the search haystack (ISSUE #475).
 *
 * The list endpoints deliberately don't publish lyric bodies, so they send a
 * small derived string instead: translations (already stored as plain text)
 * plus the furigana readings romanized by the existing shared helper. On the
 * client only this derived string is normalized, never a cached raw body.
 *
 * Only string translations are used; a damaged/malformed slot stays empty and
 * can never shift the other lines. The stored translation (whatever its
 * language) is searchable regardless of the reader's locale.
 */
export function buildLyricSearchText({
  lyrics_furigana,
  lyrics_translation,
}: {
  lyrics_furigana?: string | null;
  lyrics_translation?: string | null;
}): string {
  const translations = parseTranslationCache(lyrics_translation);
  let furigana: FuriganaLine[] = [];
  if (lyrics_furigana) {
    try {
      const parsed: unknown = JSON.parse(lyrics_furigana);
      if (Array.isArray(parsed)) {
        furigana = parsed.filter((line): line is FuriganaLine =>
          Boolean(line && typeof line === 'object' && Array.isArray((line as FuriganaLine).segments)));
      }
    } catch {
      // Damaged annotation cache — keep the translations and drop the readings.
    }
  }
  const readings = furigana.flatMap((line) => line.segments.flatMap((segment) => {
    if (!segment || typeof segment !== 'object') return [];
    const reading = typeof segment.reading === 'string' ? segment.reading : '';
    const text = typeof segment.text === 'string' ? segment.text : '';
    const resolved = reading || text;
    return resolved ? [romanizeLyricsReading(resolved)] : [];
  }));
  return normalizeSearchText([...translations, ...readings].filter(Boolean).join(' '));
}

/**
 * Haystack for a song: title, artist credits, album name, plus the precomputed
 * romanized/translated lyric text when the list endpoint supplies it.
 *
 * Album names are included in *every* list view — an album is a common way to
 * remember a song, and the album list already searched them, so leaving it out
 * of the song list made the same query work on one page and fail on the other.
 *
 * The lyric extension is additive: a query on title/artist/album still matches
 * exactly as before (ISSUE #475). Translated words can match multiple songs,
 * so callers may keep their own ranking; this predicate only decides inclusion.
 */
export function songSearchText(song: {
  title: string;
  artist?: string | null;
  spotify_album?: string | null;
  search_text?: string | null;
}): string {
  const parts = [song.title, song.artist, song.spotify_album];
  if (song.search_text) parts.push(song.search_text);
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}

/** Every term must appear in the (already normalized) haystack. */
export function matchesSearchTerms(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}
