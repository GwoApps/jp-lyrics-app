/**
 * Furigana re-derivation for legacy CRLF lyrics (issue #421).
 *
 * Provider / sync writes fold CRLF/CR to LF (see `lyrics-content.ts`), but
 * rows stored before that fold existed still carry `\r` at the end of every
 * line. Downstream readers index lyrics by `lyrics_raw.split('\n')`, so those
 * rows read back with a trailing `\r` per line — and `lyrics_furigana` was
 * derived from exactly those rows, i.e. its segment texts end with `\r` too.
 *
 * When the EOL sweep re-shapes a stored document, the annotation cache has to
 * be re-shaped with it: fold the segment texts the same way and keep the cache
 * only when it still reconstructs every line of the new (folded) text. A cache
 * that no longer matches describes lyrics that no longer exist, so it is
 * dropped — every lyric write path would invalidate it for the same reason.
 *
 * Pure on purpose: the DB sweep (`lyrics-eol-repair.ts`) calls this per row and
 * a unit test can drive it without a database.
 */

import type { FuriganaLine } from './types.ts';
import { validateFuriganaPayload } from './furigana-validation.ts';

/**
 * - `unchanged` — nothing to fold (empty cache, or no CR inside the segments).
 * - `folded`    — segment texts had CR; folded and still matches the new text.
 * - `cleared`   — the cache cannot describe the folded text any more.
 */
export type FuriganaRefoldAction = 'unchanged' | 'folded' | 'cleared';

export interface FuriganaRefoldResult {
  /** Value to store; `'[]'` when cleared, the input value when unchanged. */
  value: string;
  action: FuriganaRefoldAction;
}

/** Fold the `\r` out of every segment text, leaving malformed entries untouched. */
function foldSegmentTexts(parsed: unknown[]): { lines: unknown[]; folded: boolean } {
  let folded = false;
  const lines = parsed.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return line;
    const segments = (line as { segments?: unknown }).segments;
    if (!Array.isArray(segments)) return line;
    return {
      ...(line as Record<string, unknown>),
      segments: segments.map((segment) => {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return segment;
        const text = (segment as { text?: unknown }).text;
        if (typeof text !== 'string' || !text.includes('\r')) return segment;
        folded = true;
        // `\r\n` inside a single segment cannot be folded to `\n` without
        // inventing a line break the source line does not have into the middle
        // of that row; dropping the CR keeps the row one row (a `\r\n` that was
        // a real line break already lives in `lyrics_raw`, not in a segment).
        return { ...(segment as Record<string, unknown>), text: text.replace(/\r/g, '') };
      }),
    };
  });
  return { lines, folded };
}

/**
 * Re-shape a stored `lyrics_furigana` JSON value for `foldedRaw` (the same
 * document with every line terminator folded to `\n`).
 */
export function refoldFuriganaForLyrics(
  furiganaJson: string | null | undefined,
  foldedRaw: string,
): FuriganaRefoldResult {
  if (!furiganaJson) return { value: furiganaJson ?? '', action: 'unchanged' };
  const trimmed = furiganaJson.trim();
  // '' / '[]' are the two "nothing stored" spellings — leave the column alone.
  if (trimmed === '' || trimmed === '[]') return { value: furiganaJson, action: 'unchanged' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(furiganaJson);
  } catch {
    // Damaged value: not this sweep's job to guess (the translation/annotation
    // paths already re-derive a cache they cannot parse).
    return { value: furiganaJson, action: 'unchanged' };
  }
  if (!Array.isArray(parsed)) return { value: furiganaJson, action: 'unchanged' };

  const { lines, folded } = foldSegmentTexts(parsed);
  if (!folded) {
    // No CR in the cache. Keep it when it still reconstructs the folded text;
    // otherwise the lyrics really did change shape under it — drop it.
    return validateFuriganaPayload(parsed, foldedRaw).ok
      ? { value: furiganaJson, action: 'unchanged' }
      : { value: '[]', action: 'cleared' };
  }

  const validation = validateFuriganaPayload(lines, foldedRaw);
  if (!validation.ok) return { value: '[]', action: 'cleared' };
  return { value: JSON.stringify(validation.lines satisfies FuriganaLine[]), action: 'folded' };
}
