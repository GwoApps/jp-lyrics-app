'use client';

import type { FuriganaSegment, FuriganaLine } from './types';
import { COMPOUND_READINGS, isKanji, katakanaToHiragana } from './compound-readings';

// Singleton tokenizer — loaded once, reused across all calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizerPromise: Promise<any> | null = null;

/**
 * Lazily load kuromoji-es tokenizer from CDN.
 * Only fetched on first call; subsequent calls reuse the cached promise.
 */
async function getTokenizer() {
  if (tokenizerPromise) return tokenizerPromise;

  tokenizerPromise = (async () => {
    // Dynamic import from CDN — kuromoji-es is a pure ES module
    const cdnUrl = 'https://code4fukui.github.io/kuromoji-es/kuromoji.js';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* webpackIgnore: true */ cdnUrl);
    return mod.kuromoji.createTokenizer();
  })();

  return tokenizerPromise;
}

/**
 * Post-process furigana segments to fix number+counter compounds.
 * kuromoji tokenizes 一人 as 一+人, giving wrong per-character readings.
 * This merges adjacent single-kanji segments and applies corrected readings.
 */
function fixCompoundReadings(segments: FuriganaSegment[]): FuriganaSegment[] {
  if (segments.length < 2) return segments;

  const result: FuriganaSegment[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];

    // Look for runs of single-kanji segments that could be compounds
    if (seg.text.length === 1 && isKanji(seg.text) && seg.reading) {
      // Try progressively longer compounds (2-4 chars)
      let bestMerge: { text: string; reading: string; endIdx: number } | null = null;

      for (let len = 4; len >= 2; len--) {
        if (i + len > segments.length) continue;

        // Check if all segments in range are single-kanji with readings
        const allSingleKanji = segments.slice(i, i + len).every(
          (s) => s.text.length === 1 && isKanji(s.text) && s.reading
        );
        if (!allSingleKanji) continue;

        const compound = segments.slice(i, i + len).map((s) => s.text).join('');
        const corrected = COMPOUND_READINGS[compound];
        if (corrected) {
          bestMerge = { text: compound, reading: corrected, endIdx: i + len };
          break; // prefer longest match
        }
      }

      if (bestMerge) {
        result.push({ text: bestMerge.text, reading: bestMerge.reading });
        i = bestMerge.endIdx;
        continue;
      }
    }

    result.push(seg);
    i++;
  }

  return result;
}

/**
 * Convert raw Japanese lyrics into furigana-annotated structure.
 * Runs entirely in the browser using kuromoji-es from CDN.
 * Dictionary (~17MB) is loaded only on first call, then cached.
 */
export async function convertToFuriganaClient(rawLyrics: string): Promise<FuriganaLine[]> {
  const tokenizer = await getTokenizer();
  const lines = rawLyrics.split('\n');
  const result: FuriganaLine[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      result.push({ segments: [] });
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokens: any[] = tokenizer.tokenize(line);
    const segments: FuriganaSegment[] = [];

    for (const token of tokens) {
      const text = token.surface_form;
      // kuromoji returns katakana reading; convert to hiragana
      const reading = token.reading ? katakanaToHiragana(token.reading) : '';
      // Only add reading for kanji-containing tokens where reading differs
      const hasKanji = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
      const finalReading = hasKanji && reading !== text ? reading : '';
      segments.push({ text, reading: finalReading });
    }

    result.push({ segments: fixCompoundReadings(segments) });
  }

  return result;
}
