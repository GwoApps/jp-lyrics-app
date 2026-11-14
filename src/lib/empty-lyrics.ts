/**
 * Why a song page has no lyric text to show (issue #420).
 *
 * `createPlainFuriganaLines('')` returns a single empty line (`''.split('\n')` is
 * `['']`), so an empty `lyrics_raw` still yields one furigana line. The detail
 * page must therefore branch on the *text*, not on the line count — the line
 * count is load-bearing for translation/furigana/timeline index alignment and
 * must stay as-is.
 */
import { isEmptyAfterTrim } from './lyrics-export.ts';

/** `never-fetched` = nobody looked yet; `not-found` = sources were queried and returned nothing. */
export type EmptyLyricsReason = 'never-fetched' | 'not-found';

/** Whether the song has any visible lyric text (invisible whitespace counts as empty). */
export function hasLyricsContent(lyricsRaw: string | null | undefined): boolean {
  return !isEmptyAfterTrim(lyricsRaw);
}

/**
 * Distinguish "not fetched yet" from "fetched, but nothing out there" so the
 * empty panel can word itself honestly. A `lyrics_source` other than `manual`
 * — or any recorded `lyrics_fetched_at` — proves a provider was actually asked.
 */
export function emptyLyricsReason(song: {
  lyrics_source?: string | null;
  lyrics_fetched_at?: string | null;
} | null | undefined): EmptyLyricsReason {
  const source = (song?.lyrics_source ?? '').trim();
  if (source && source !== 'manual') return 'not-found';
  return song?.lyrics_fetched_at ? 'not-found' : 'never-fetched';
}
