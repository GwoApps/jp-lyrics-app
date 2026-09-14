/**
 * Progress helpers for the translate SSE stream.
 *
 * While the model is streaming its (possibly unterminated) JSON array
 * response, these helpers estimate how many lyric lines have been fully
 * translated so far and extract the complete items — so the server can emit
 * live `progress` events and persist partial work before a failure.
 *
 * Translations are plain strings, so the scanner only needs to track the
 * array brackets and quoted strings (escaped quotes included). Depth is
 * relative to the opening bracket of the top-level array (which is consumed
 * before scanning begins), so a `]` at depth 0 closes the top-level array.
 *
 * Two extraction modes (see `extractCompletedArrayItems`):
 *   - default — progress COUNTING contract: non-string items (null / numbers /
 *     objects / nested arrays) are skipped, so the count is "how many
 *     translation strings arrived".
 *   - `indexAligned: true` — PERSISTENCE contract: the same scanner, but a
 *     non-string item is emitted as `''` AT ITS ORIGINAL INDEX (issue #278),
 *     matching `parseTranslationCache` so a streamed partial never shifts the
 *     lines it is written to.
 */

/**
 * Full-song translation coverage over NON-EMPTY lyric lines (duplicate
 * choruses expanded, blank lines skipped). `coverable` is how many non-empty
 * source lines exist; `covered` is how many of those currently have a
 * non-empty translation. This is the reliable "how much of the whole song is
 * translated" number — independent of how many DISTINCT lines the model had
 * to process (which is the request-progress denominator).
 *
 * `cache` must be index-aligned to `sourceLines` (see parseTranslationCache).
 */
export function computeCoverage(
  sourceLines: string[],
  cache: string[],
): { covered: number; coverable: number } {
  let covered = 0;
  let coverable = 0;
  sourceLines.forEach((raw, i) => {
    if (!raw.trim()) return;
    coverable += 1;
    if ((cache[i] ?? '').trim() !== '') covered += 1;
  });
  return { covered, coverable };
}

/**
 * Count the complete STRING elements present in a JSON array that may still be
 * streaming — the progress-counting contract.
 *
 * Non-string items (null / numbers / objects / nested arrays) are skipped, so
 * the number is "how many translations arrived", not "how many request lines
 * are decided". Use `extractCompletedArrayItems(text, { indexAligned: true })`
 * when the count must match the lines that are actually persisted (issue #278).
 */
export function countCompletedArrayItems(text: string): number {
  const start = text.indexOf('[');
  if (start === -1) return 0;
  let count = 0;
  let i = start + 1;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let elementStarted = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; elementStarted = true; i++; continue; }
    if (ch === '[') { depth++; i++; continue; }
    if (ch === ']') {
      if (depth === 0) {
        // Top-level array closed. We are outside a string here, so any
        // element started since the last comma is complete.
        return elementStarted ? count + 1 : count;
      }
      depth--;
      i++;
      continue;
    }
    if (ch === ',' && depth === 0) {
      // The element before this comma is complete.
      count += elementStarted ? 1 : 0;
      elementStarted = false;
      i++;
      continue;
    }
    if (!/\s/.test(ch)) elementStarted = true;
    i++;
  }
  // Array still open: comma-terminated elements count, plus a completed
  // trailing string (we are outside a string, so its closing quote arrived).
  return count + (elementStarted && !inString ? 1 : 0);
}

/**
 * Extract the complete elements from a possibly-unterminated JSON array.
 *
 * Default — progress contract: only complete string elements are returned, in
 * stream order. Non-string items are skipped, which COMPRESSES the array (the
 * item after a `null` moves up one index). Only safe where the result is used
 * to count, never to write translations back to lyric lines.
 *
 * `{ indexAligned: true }` — persistence contract (issue #278): non-string
 * items (null / numbers / objects / nested arrays) are emitted as `''` AT THEIR
 * ORIGINAL INDEX instead of being skipped, so result[i] always belongs to
 * request line i. Identical to `parseTranslationCache`'s policy for stored
 * caches, and the only safe mode for persisting partial stream results.
 */
export function extractCompletedArrayItems(
  text: string,
  opts: { indexAligned?: boolean } = {},
): string[] {
  const indexAligned = opts.indexAligned === true;
  const start = text.indexOf('[');
  if (start === -1) return [];
  const items: string[] = [];
  let i = start + 1;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let current = '';
  let closed = false;
  /**
   * Classify one complete top-level element.
   *
   * Progress mode only keeps parseable strings; index-aligned mode always
   * reserves a slot so following items keep their line numbers (a non-string
   * item is visible precisely because `current` does not start with a quote).
   */
  const push = () => {
    const trimmed = current.trim();
    if (trimmed.startsWith('"')) {
      // A quoted element that reaches a separator/terminator is complete, so
      // JSON.parse can only fail on malformed escaping — drop that item rather
      // than invent a translation (unchanged behaviour).
      try { items.push(JSON.parse(trimmed) as string); } catch { /* ignore */ }
      return;
    }
    if (indexAligned && trimmed !== '') items.push('');
  };
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; current += ch; i++; continue; }
    if (ch === '[') { depth++; current += ch; i++; continue; }
    if (ch === ']') {
      if (depth === 0) {
        push();
        closed = true;
        break;
      }
      depth--;
      current += ch;
      i++;
      continue;
    }
    if (ch === ',' && depth === 0) {
      push();
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  // Open array without a closing bracket: a complete trailing element survives.
  // Only a finished element may be emitted — while `inString` the element is
  // still arriving, so its (unterminated) text is never yielded.
  if (!closed && !inString) push();
  return items;
}
