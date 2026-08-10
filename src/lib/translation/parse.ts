/**
 * Response parsing helpers: JSON-array-first extraction with a strict
 * line-count normalization that maps model output back to the source lines.
 */

/** Extract the first JSON array found in a model response. */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Normalize a parsed array to exactly match the source line count; empty source lines stay empty. */
export function normalizeTranslations(sourceLines: string[], parsed: unknown): string[] {
  const raw = Array.isArray(parsed)
    ? parsed.map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    : [];
  return sourceLines.map((source, i) => (source.trim() ? (raw[i] ?? '').trim() : ''));
}

/**
 * Parse a stored translation-cache JSON string into a string[] that stays
 * index-aligned to `lyrics_raw.split('\n')`.
 *
 * The core invariant is that each array index maps to the same source-lyric
 * line. Non-string entries (null/numbers/objects) are therefore REPLACED with
 * `''` at their original index — never filtered away — so a damaged/stale
 * slot degrades to "this line is untranslated" instead of shifting every
 * later line up by one.
 *
 * When `totalLines` is given the result is truncated (extra entries dropped)
 * or padded (missing lines filled with `''`) to exactly that many entries.
 * When omitted the original array length is preserved so callers that only
 * look up by source index keep working without a line count.
 */
export function parseTranslationCache(
  raw: string | null | undefined,
  totalLines?: number,
): string[] {
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Damaged cache — start from an empty seed (same policy as the route).
    }
  }

  const length = totalLines ?? (Array.isArray(parsed) ? parsed.length : 0);
  const result: string[] = Array(length).fill('');
  if (Array.isArray(parsed)) {
    parsed.forEach((item, i) => {
      if (i >= result.length) return;
      if (typeof item === 'string') {
        result[i] = item;
      } else {
        console.warn(
          `[translation-cache] non-string translation entry at index ${i} replaced with '' — ` +
          'check for stale/migrated data',
        );
      }
    });
  }
  return result;
}
