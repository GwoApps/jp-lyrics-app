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

export function normalizeReadingScheme(value: unknown): ReadingScheme {
  return value === 'yue-jyutping' ? 'yue-jyutping' : 'ja-kana';
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
