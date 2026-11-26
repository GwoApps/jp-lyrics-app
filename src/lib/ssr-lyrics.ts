/**
 * Read-only lyric payload embedded in the first HTML response (issue #465).
 *
 * The song page used to ship only a skeleton: the client fetched `/api/songs/[id]`
 * after hydration, so on 4G the first lyric line took ~5s to appear even though
 * `generateMetadata` had already read that line on the server. This module owns
 * the tiny, script-free payload that makes the first paint useful. It is pure
 * and React-free so both the server layout and the client page can consume it
 * and unit tests can run it with plain `node --test`.
 */
import { stripLrcTimestampsFromLine } from './lrc.ts';
import { normalizeReadingScheme, sourceLyricsLang } from './lyrics-reading.ts';
import type { ReadingScheme } from './types.ts';

export const SSR_LYRICS_LIMIT = 12;

export interface SsrLyricLine {
  /** Plain text with LRC tags/timestamps removed — no interaction, no markup. */
  text: string;
}

export interface SsrLyricsPayload {
  songId: string;
  lines: SsrLyricLine[];
  /** BCP-47 tag of the source lyrics, derived from the song's reading scheme. */
  lang: string;
  /** True when `lines` was cut at {@link SSR_LYRICS_LIMIT}. */
  truncated: boolean;
}

/** Metadata tag such as `[ti:…]` / `[ar:…]`, which is not a lyric line. */
const METADATA_TAG_RE = /^\[[a-zA-Z]+:[^\]]*\]$/;

/**
 * Build the read-only first-paint payload. Every stored row is represented so
 * the shared-line deep link (`?line=N`, issue #463) and furigana/timeline index
 * alignment stay identical; blank rows stay blank. Only the first
 * {@link SSR_LYRICS_LIMIT} rows are shipped, which keeps the HTML bounded.
 *
 * ACL is the caller's responsibility: only call this for a song the viewer is
 * allowed to see, and only payloads for public song pages may be cached.
 */
export function buildSsrLyrics({
  songId,
  lyricsRaw,
  readingScheme,
  limit = SSR_LYRICS_LIMIT,
}: {
  songId: string;
  lyricsRaw: string | null | undefined;
  readingScheme?: unknown;
  limit?: number;
}): SsrLyricsPayload {
  const raw = lyricsRaw ?? '';
  const source = raw ? raw.split(/\r?\n/) : [];
  const lines = source
    .map((row) => {
      const trimmed = row.trim();
      if (!trimmed || METADATA_TAG_RE.test(trimmed)) return { text: '' };
      return { text: stripLrcTimestampsFromLine(trimmed) };
    })
    .filter((_, index) => index < limit);
  const scheme: ReadingScheme = normalizeReadingScheme(readingScheme);
  return {
    songId,
    lines,
    lang: sourceLyricsLang(scheme),
    truncated: source.length > limit,
  };
}
