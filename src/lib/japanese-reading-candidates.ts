import dictionary from './dictionaries/japanese-readings.json' with { type: 'json' };
import { splitJapaneseKanjiReading } from './japanese-kanji-reading';
import { katakanaToHiragana } from './compound-readings';
import type { JapaneseReadingContext } from './japanese-reading-context';
import { getInflectedJapaneseReadings, type JapaneseLexemes } from './japanese-inflection';

interface ReadingDictionary {
  kanji: Record<string, string[]>;
  words: Record<string, string[]>;
  kun: Record<string, string[][]>;
  lexemes: JapaneseLexemes;
}
const data: ReadingDictionary = dictionary;
const KANJI_RE = /\p{Script=Han}/u;
const MAX_CANDIDATES = 24;

function wordReadings(surface: string): string[] {
  return [...new Set([
    ...(data.words[surface] ?? []),
    ...getInflectedJapaneseReadings(surface, data.lexemes),
  ])];
}

function alignReading(text: string, context: JapaneseReadingContext, reading: string): string | null {
  if (context.start === 0 && context.word === text) return reading;
  let offset = 0;
  for (const segment of splitJapaneseKanjiReading({ text: context.word, reading })) {
    if (offset === context.start && segment.text === text && segment.reading) return segment.reading;
    offset += segment.text.length;
  }
  return null;
}

/** Entirely local: compound readings are never fabricated from character combinations. */
export function getJapaneseReadingCandidates(text: string, context: JapaneseReadingContext = { word: text, start: 0 }): string[] {
  if (!text || text.length > 32 || !KANJI_RE.test(text)) return [];
  if (!Number.isInteger(context.start) || context.start < 0 || context.word.length > 64
    || context.word.slice(context.start, context.start + text.length) !== text) return [];

  const candidates: string[] = [];
  for (const reading of wordReadings(context.word)) {
    const aligned = alignReading(text, context, reading);
    if (aligned) candidates.push(aligned);
  }
  const hasKanaContext = /^[\p{Script=Han}々]+$/u.test(text)
    && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(context.word);
  if (hasKanaContext) {
    // Isolated meanings/readings need not fit a word's existing okurigana:
    // 生's うま is valid in isolation, but would produce うままれる here.
    if ([...text].length === 1) {
      const prefix = context.word.slice(0, context.start);
      const suffix = katakanaToHiragana(context.word.slice(context.start + text.length));
      if (!KANJI_RE.test(prefix)) {
        for (const [stem, okurigana] of data.kun[text] ?? []) {
          if (okurigana === suffix) candidates.push(stem);
        }
      }
    }
  } else {
    candidates.push(...(data.words[text] ?? []));
    if ([...text].length === 1) candidates.push(...(data.kanji[text] ?? []));
  }
  return [...new Set(candidates.filter(Boolean))].slice(0, MAX_CANDIDATES);
}
