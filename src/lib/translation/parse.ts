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
