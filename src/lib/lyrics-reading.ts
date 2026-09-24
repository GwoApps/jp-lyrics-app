import type { FuriganaLine, FuriganaSegment, ReadingScheme } from './types';

export interface CantoneseDetectionResult {
  suggested: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

const STRONG_CANTONESE_MARKERS = [
  '冇', '嘅', '喺', '咗', '哋', '啲', '嗰', '佢', '唔', '咁', '嘢', '嚟',
  '㗎', '喇', '囉', '喎', '啫', '搵', '瞓', '攰',
] as const;

const CANTONESE_PHRASES = [
  '點解', '做乜', '唔係', '有冇', '而家', '幾時', '一齊', '鍾意',
  '諗住', '返嚟', '等陣', '冇所謂',
] as const;

const KANA_RE = /[\u3040-\u30ff]/u;
const LRC_TIMESTAMP_RE = /^\s*(?:\[[^\]]*\]\s*)+/u;

/**
 * Single source of truth for what a reading scheme implies about the source
 * lyrics. Every scheme-dependent decision (source-language tag for the
 * translation prompt, BCP-47 tag for `lang` attributes / HTML export, reading
 * conversion, …) reads this table instead of comparing the scheme literal
 * inline — so adding a scheme means adding ONE entry here, not hunting down
 * every `=== 'yue-jyutping'` branch.
 *
 * `sourceLang` is the short tag consumed by the translation prompt
 * (`TranslationContext.sourceLang`, i.e. `ja` | `yue`); `bcp47` is the full
 * tag used for markup. Both are inherently required — a scheme with no entry
 * cannot be supported, and the record type makes a missing one a build error.
 */
const READING_SCHEME_SOURCE: Record<ReadingScheme, { sourceLang: string; bcp47: string }> = {
  'ja-kana': { sourceLang: 'ja', bcp47: 'ja' },
  'yue-jyutping': { sourceLang: 'yue', bcp47: 'yue-Hant' },
};

/** Reading scheme assumed for songs with an unknown / NULL / legacy value. */
export const DEFAULT_READING_SCHEME: ReadingScheme = 'ja-kana';

/**
 * Narrow an arbitrary stored value to a known {@link ReadingScheme}, falling
 * back to {@link DEFAULT_READING_SCHEME} so legacy/unknown rows keep behaving
 * like Japanese songs.
 */
export function normalizeReadingScheme(value: unknown): ReadingScheme {
  return typeof value === 'string' && Object.hasOwn(READING_SCHEME_SOURCE, value)
    ? value as ReadingScheme
    : DEFAULT_READING_SCHEME;
}

/**
 * Short source-language tag of the lyrics (`ja` | `yue`), straight from the
 * scheme table. This is the value the translation prompt expects — do NOT
 * compare the scheme literal at the call site.
 */
export function sourceLangOf(value: unknown): string {
  return READING_SCHEME_SOURCE[normalizeReadingScheme(value)].sourceLang;
}

/**
 * BCP-47 tag of the source lyrics, derived from the song's reading scheme:
 * Japanese kana readings imply Japanese lyrics, jyutping readings imply
 * Cantonese (traditional Chinese) lyrics.
 *
 * Used for the `lang` attribute of source-lyric containers and as the document
 * language of the HTML export, so the browser and screen readers pick the right
 * pronunciation rules and CJK glyph shapes for the original text instead of
 * inheriting the UI language (issue #274).
 */
export function sourceLyricsLang(value: unknown): string {
  return READING_SCHEME_SOURCE[normalizeReadingScheme(value)].bcp47;
}

function uniqueLyricText(rawLyrics: string): string {
  const seen = new Set<string>();
  for (const rawLine of rawLyrics.normalize('NFC').split('\n')) {
    const line = rawLine.replace(LRC_TIMESTAMP_RE, '').trim();
    if (line) seen.add(line);
  }
  return [...seen].join('\n');
}

export function detectCantoneseLyrics(rawLyrics: string): CantoneseDetectionResult {
  const lyrics = uniqueLyricText(rawLyrics);
  if (!lyrics || KANA_RE.test(lyrics)) {
    return { suggested: false, confidence: 'low', reasons: [] };
  }

  const markers = STRONG_CANTONESE_MARKERS.filter((marker) => lyrics.includes(marker));
  const phrases = CANTONESE_PHRASES.filter((phrase) => lyrics.includes(phrase));
  const reasons = [...new Set([...phrases, ...markers])];
  const high = markers.length >= 2 || phrases.length >= 2 || (markers.length >= 1 && phrases.length >= 1);
  const medium = !high && (markers.length === 1 || phrases.length === 1);

  return {
    suggested: high || medium,
    confidence: high ? 'high' : medium ? 'medium' : 'low',
    reasons,
  };
}

export async function convertCantoneseLyrics(rawLyrics: string): Promise<FuriganaLine[]> {
  const { getJyutpingList } = await import('to-jyutping');
  return rawLyrics.split('\n').map((line) => {
    if (!line.trim()) return { segments: [] };
    const segments: FuriganaSegment[] = getJyutpingList(line).map(([text, reading]) => ({
      text,
      reading: reading ?? '',
    }));
    return { segments };
  });
}

export async function getCantoneseReadingCandidates(text: string): Promise<string[]> {
  const { getJyutpingCandidates, getJyutpingList } = await import('to-jyutping');
  const contextual = getJyutpingList(text)
    .map(([, reading]) => reading)
    .filter((reading): reading is string => Boolean(reading))
    .join(' ');
  const alternatives = Array.from(text).length === 1
    ? getJyutpingCandidates(text)[0]?.[1] ?? []
    : [];
  return [...new Set([contextual, ...alternatives].filter(Boolean))];
}

export async function convertLyricsReading(rawLyrics: string, scheme: ReadingScheme): Promise<FuriganaLine[]> {
  if (scheme === 'yue-jyutping') return convertCantoneseLyrics(rawLyrics);
  const { convertToFuriganaClient } = await import('./kuroshiro-client');
  return convertToFuriganaClient(rawLyrics);
}
