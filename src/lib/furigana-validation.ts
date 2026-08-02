import type { FuriganaLine } from './types';

type ValidationResult =
  | { ok: true; lines: FuriganaLine[] }
  | { ok: false; error: 'invalid_furigana' | 'furigana_source_mismatch' };

const MAX_LINES = 10_000;
const MAX_SEGMENTS_PER_LINE = 10_000;
const MAX_TEXT_LENGTH = 4_096;
const MAX_READING_LENGTH = 256;
const MAX_TOTAL_CHARACTERS = 1_000_000;

/** Checks whether stored annotations still reconstruct the current lyric source. */
export function furiganaLinesMatchSource(value: unknown, sourceLyrics: string): value is FuriganaLine[] {
  if (!Array.isArray(value)) return false;
  const sourceLines = sourceLyrics.split('\n');
  return value.length === sourceLines.length && value.every((line, index) => (
    line
    && typeof line === 'object'
    && !Array.isArray(line)
    && Array.isArray((line as { segments?: unknown }).segments)
    && (line as { segments: unknown[] }).segments.every((segment) => (
      segment
      && typeof segment === 'object'
      && !Array.isArray(segment)
      && typeof (segment as { text?: unknown }).text === 'string'
      && typeof (segment as { reading?: unknown }).reading === 'string'
    ))
    && ((line as { segments: { text: string }[] }).segments.map((segment) => segment.text).join('') === sourceLines[index])
  ));
}

export function validateFuriganaPayload(value: unknown, sourceLyrics: string): ValidationResult {
  if (!Array.isArray(value) || value.length > MAX_LINES) {
    return { ok: false, error: 'invalid_furigana' };
  }

  const sourceLines = sourceLyrics.split('\n');
  if (value.length !== sourceLines.length) {
    return { ok: false, error: 'furigana_source_mismatch' };
  }

  let totalCharacters = 0;
  const lines: FuriganaLine[] = [];

  for (let lineIndex = 0; lineIndex < value.length; lineIndex += 1) {
    const line = value[lineIndex];
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return { ok: false, error: 'invalid_furigana' };
    }

    const segments = (line as { segments?: unknown }).segments;
    if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS_PER_LINE) {
      return { ok: false, error: 'invalid_furigana' };
    }

    const validatedSegments: FuriganaLine['segments'] = [];
    for (const segment of segments) {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
        return { ok: false, error: 'invalid_furigana' };
      }
      const { text, reading } = segment as { text?: unknown; reading?: unknown };
      if (
        typeof text !== 'string'
        || text.length === 0
        || text.length > MAX_TEXT_LENGTH
        || typeof reading !== 'string'
        || reading.length > MAX_READING_LENGTH
      ) {
        return { ok: false, error: 'invalid_furigana' };
      }
      totalCharacters += text.length + reading.length;
      if (totalCharacters > MAX_TOTAL_CHARACTERS) {
        return { ok: false, error: 'invalid_furigana' };
      }
      validatedSegments.push({ text, reading });
    }

    if (validatedSegments.map((segment) => segment.text).join('') !== sourceLines[lineIndex]) {
      return { ok: false, error: 'furigana_source_mismatch' };
    }
    lines.push({ segments: validatedSegments });
  }

  return { ok: true, lines };
}
