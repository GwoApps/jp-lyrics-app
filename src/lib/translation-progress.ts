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
 */

/** Count the complete string elements present in a JSON array that may still be streaming. */
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

/** Extract the complete string elements from a possibly-unterminated JSON array, in stream order. */
export function extractCompletedArrayItems(text: string): string[] {
  const start = text.indexOf('[');
  if (start === -1) return [];
  const items: string[] = [];
  let i = start + 1;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let current = '';
  let closed = false;
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
        const trimmed = current.trim();
        if (trimmed.startsWith('"')) {
          try { items.push(JSON.parse(trimmed) as string); } catch { /* ignore */ }
        }
        closed = true;
        break;
      }
      depth--;
      current += ch;
      i++;
      continue;
    }
    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.startsWith('"')) {
        try { items.push(JSON.parse(trimmed) as string); } catch { /* ignore */ }
      }
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  // Open array without a closing bracket: a complete trailing string survives.
  if (!closed) {
    const trimmed = current.trim();
    if (trimmed.startsWith('"') && !inString) {
      try { items.push(JSON.parse(trimmed) as string); } catch { /* ignore */ }
    }
  }
  return items;
}
