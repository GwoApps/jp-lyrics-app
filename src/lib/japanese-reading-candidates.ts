import dictionary from './dictionaries/japanese-readings.json' with { type: 'json' };
import { splitJapaneseKanjiReading } from './japanese-kanji-reading';
import { katakanaToHiragana } from './compound-readings';
import type { JapaneseReadingContext } from './japanese-reading-context';

interface ReadingDictionary {
  kanji: Record<string, string[]>;
  words: Record<string, string[]>;
  kun: Record<string, string[][]>;
}
const data: ReadingDictionary = dictionary;
const KANJI_RE = /\p{Script=Han}/u;
const MAX_CANDIDATES = 24;

// Dictionary-checked inflection hypotheses only, never synthetic pronunciations.
// Each pair maps a surface suffix back to a lexical suffix. Transform the matched
// dictionary reading to the same surface before aligning its kana to the text.
const INFLECTIONS: readonly (readonly [string, string])[] = [
  ['って', 'う'], ['って', 'つ'], ['って', 'る'],
  ['った', 'う'], ['った', 'つ'], ['った', 'る'],
  ['んで', 'む'], ['んで', 'ぶ'], ['んで', 'ぬ'],
  ['んだ', 'む'], ['んだ', 'ぶ'], ['んだ', 'ぬ'],
  ['いて', 'く'], ['いた', 'く'], ['いで', 'ぐ'], ['いだ', 'ぐ'],
  ['して', 'す'], ['した', 'す'], ['して', 'する'], ['した', 'する'],
  ['て', 'る'], ['た', 'る'], ['ない', 'る'], ['なかった', 'る'],
  ['かった', 'い'], ['くて', 'い'],
  ['い', 'う'], ['き', 'く'], ['ぎ', 'ぐ'], ['し', 'す'],
  ['ち', 'つ'], ['に', 'ぬ'], ['び', 'ぶ'], ['み', 'む'], ['り', 'る'],
  ['', 'る'],
];
const POLITE_ENDINGS = ['ます', 'ました', 'ません', 'ませんでした', 'ましょう'];
const GODAN_STEMS: readonly (readonly [string, string])[] = [
  ['い', 'う'], ['き', 'く'], ['ぎ', 'ぐ'], ['し', 'す'],
  ['ち', 'つ'], ['に', 'ぬ'], ['び', 'ぶ'], ['み', 'む'], ['り', 'る'],
];

function wordReadings(surface: string): string[] {
  const readings = [...(data.words[surface] ?? [])];
  const irregularEndings: Record<string, [string, string]> = {
    'て': ['きて', 'して'], 'た': ['きた', 'した'],
    'ない': ['こない', 'しない'], 'なかった': ['こなかった', 'しなかった'],
    'ます': ['きます', 'します'], 'ました': ['きました', 'しました'],
    'ません': ['きません', 'しません'], 'ませんでした': ['きませんでした', 'しませんでした'],
    'ましょう': ['きましょう', 'しましょう'],
  };
  for (const [ending, [come, doReading]] of Object.entries(irregularEndings)) {
    for (const [spelling, lemmaEnding, readingEnding, inflected] of [
      ['来', '来る', 'くる', come], ['為', '為る', 'する', doReading],
    ]) {
      const suffix = spelling + ending;
      if (!surface.endsWith(suffix)) continue;
      const lemma = surface.slice(0, -suffix.length) + lemmaEnding;
      for (const reading of data.words[lemma] ?? []) {
        if (reading.endsWith(readingEnding)) readings.push(reading.slice(0, -readingEnding.length) + inflected);
      }
    }
  }
  const rules = [...INFLECTIONS];
  for (const ending of POLITE_ENDINGS) {
    rules.push([ending, 'る']);
    for (const [stem, base] of GODAN_STEMS) rules.push([stem + ending, base]);
  }
  // 行く has irregular gemination, unlike other -く verbs.
  if (surface === '行った' || surface === '行って') {
    for (const reading of data.words['行く'] ?? []) {
      if (reading.endsWith('く')) readings.push(reading.slice(0, -1) + (surface.endsWith('た') ? 'った' : 'って'));
    }
  }
  for (const [ending, base] of rules) {
    if (!surface.endsWith(ending) || surface.length <= ending.length) continue;
    const lemma = (ending ? surface.slice(0, -ending.length) : surface) + base;
    for (const reading of data.words[lemma] ?? []) {
      if (lemma === '来る' || (lemma.endsWith('来る') && reading.endsWith('くる')) || lemma.endsWith('為る')) continue;
      if (reading.endsWith(base)) readings.push(reading.slice(0, -base.length) + ending);
    }
  }
  return [...new Set(readings)];
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
