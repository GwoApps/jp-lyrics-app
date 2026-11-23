/**
 * Helpers for the line-level song deep link (`/songs/[id]?line=N`).
 *
 * `?line=` counts source lines in `lyrics_raw` (the same index the share card
 * stores on each lyric block). Blank source rows still occupy a rendered row.
 */

/** Parse a source-line index from a query value; invalid values are ignored. */
export function parseSharedSourceLine(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const line = Number(raw.trim());
  return Number.isSafeInteger(line) ? line : null;
}

/** Build the song URL used by both the share card's QR code and copy-link. */
export function buildSharedSongUrl(origin: string, songId: string, rawLine: string | null | undefined): string {
  const base = `${origin}/songs/${songId}`;
  const line = parseSharedSourceLine(rawLine);
  return line === null ? base : `${base}?line=${line}`;
}

/**
 * Map a shared source-line index to its rendered lyric-row index.
 * Returns null for invalid, out-of-range or blank source lines.
 */
export function resolveSharedLyricLine(raw: string | null | undefined, lyricsRaw: string | null | undefined): number | null {
  const sourceLine = parseSharedSourceLine(raw);
  if (sourceLine === null) return null;
  const sourceLines = (lyricsRaw ?? '').split('\n');
  if (sourceLine >= sourceLines.length || !sourceLines[sourceLine].trim()) return null;
  return sourceLine;
}
