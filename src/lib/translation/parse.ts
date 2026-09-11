/**
 * Response parsing helpers: JSON-array-first extraction with a strict
 * line-count normalization that maps model output back to the source lines.
 *
 * Parsing contract (issue #271): a response that *looks like* a JSON array is
 * NEVER split by newline. When the array is incomplete or slightly invalid
 * (truncated by max_tokens, trailing comma, two arrays restated) only the
 * COMPLETE array items are salvaged — the same contract the resume path uses —
 * so JSON syntax fragments can never end up in a translation slot. When
 * nothing complete can be salvaged the response is rejected with
 * `translation_invalid_response`.
 */

import { TranslationError } from './config.ts';
import { extractCompletedArrayItems } from '../translation-progress.ts';

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
 * True when the model was answering with JSON — complete or not.
 *
 * Only a response that is *obviously not* JSON may use the line-per-translation
 * fallback, so the signal is deliberately broad: either the response opens with
 * an array bracket, or it contains a quoted JSON structure (`["…"`, `{"…"`)
 * anywhere — e.g. prose/a preamble followed by a truncated array. Anything
 * else is treated as plain text.
 */
export function looksLikeJsonArrayResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('[') || /[[{]\s*"/.test(trimmed);
}

export type TranslationResponseShape = 'json' | 'json_partial' | 'text';

export interface ParsedTranslationResponse {
  /** Translations index-aligned to the requested lines (same length). */
  translations: string[];
  /** How the response was interpreted — for logging/triage. */
  shape: TranslationResponseShape;
  /** How many requested lines received a non-empty translation. */
  filled: number;
}

/**
 * Map a raw model response onto the requested lyric lines.
 *
 * 1. `json` — a complete JSON array (the canonical contract).
 * 2. `json_partial` — a JSON array that is incomplete/invalid: only the
 *    complete items are kept and the remaining lines stay `''`, so they can be
 *    re-translated (resume contract). This is what turns a `max_tokens`
 *    truncation / trailing comma / restated array into "a few lines missing"
 *    instead of "JSON syntax written into the cache". If not a single complete
 *    item can be salvaged the response is rejected.
 * 3. `text` — a genuinely non-JSON response (plain text, one line per
 *    requested line), accepted only when the non-empty line count matches the
 *    requested non-blank lines exactly. A mismatch means prose/preamble or a
 *    re-listing, and mapping it onto lyric lines would shift every translation.
 *
 * Throws `TranslationError('translation_invalid_response')` when the response
 * cannot be trusted — never returns a JSON-syntax fragment as a translation.
 */
export function parseTranslationResponse(text: string, lines: string[]): ParsedTranslationResponse {
  const parsed = extractJsonArray(text);
  if (Array.isArray(parsed)) {
    // A translation array must be flat strings. A nested object/array element
    // means the model answered with a structure the aligned contract has no
    // slot for — it must never be coerced into a translation slot (that is how
    // "[object Object]" used to end up in the cache).
    if (parsed.some((item) => typeof item === 'object' && item !== null)) {
      throw new TranslationError(
        'translation_invalid_response',
        'translation array contains non-string (JSON object/array) items',
      );
    }
    const translations = normalizeTranslations(lines, parsed);
    return { translations, shape: 'json', filled: countFilled(translations) };
  }

  if (looksLikeJsonArrayResponse(text)) {
    // A JSON attempt that did not parse (the parseable case is handled above) —
    // keep the complete items only, never the raw text.
    const salvaged = extractCompletedArrayItems(text);
    if (salvaged.length === 0) {
      throw new TranslationError(
        'translation_invalid_response',
        `unparseable JSON response (${text.length} chars, no complete array item)`,
      );
    }
    const translations = normalizeTranslations(lines, salvaged);
    return { translations, shape: 'json_partial', filled: countFilled(translations) };
  }

  // Plain text: one line per requested (non-blank) lyric line, in order.
  // Blank source lines stay blank — plain-text output commonly omits them,
  // so the response lines are aligned against the non-blank source lines
  // instead of being pasted at the same index (which would shift everything
  // after a blank line).
  const responseLines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const targetIndices = lines
    .map((line, index) => (line.trim() ? index : -1))
    .filter((index) => index >= 0);
  if (responseLines.length !== targetIndices.length) {
    throw new TranslationError(
      'translation_invalid_response',
      `plain-text response has ${responseLines.length} line(s) for ${targetIndices.length} requested line(s)`,
    );
  }
  const translations: string[] = Array(lines.length).fill('');
  targetIndices.forEach((lineIndex, i) => { translations[lineIndex] = responseLines[i]; });
  return { translations, shape: 'text', filled: countFilled(translations) };
}

function countFilled(translations: string[]): number {
  return translations.filter((item) => item !== '').length;
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
