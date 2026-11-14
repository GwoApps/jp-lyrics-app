import { foldKatakanaToHiragana } from './japanese-fold.ts';

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
 * Haystack for a song: title, artist credits and album name.
 *
 * Album names are included in *every* list view — an album is a common way to
 * remember a song, and the album list already searched them, so leaving it out
 * of the song list made the same query work on one page and fail on the other.
 */
export function songSearchText(song: {
  title: string;
  artist?: string | null;
  spotify_album?: string | null;
}): string {
  return normalizeSearchText(
    [song.title, song.artist, song.spotify_album].filter(Boolean).join(' '),
  );
}

/** Every term must appear in the (already normalized) haystack. */
export function matchesSearchTerms(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}
