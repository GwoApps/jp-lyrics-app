import type { ReadingScheme } from './types';

const BASIC: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  ゔ: 'vu', ゕ: 'ka', ゖ: 'ke',
  '\u309d': '', '\u309e': '', '\u309b': '', '\u309c': '', '\u30fb': '',
  '\u30fd': '', '\u30fe': '',
};

const COMBOS: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  しぇ: 'she', じぇ: 'je', ちぇ: 'che',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  くぁ: 'kwa', くぃ: 'kwi', くぇ: 'kwe', くぉ: 'kwo',
  ぐぁ: 'gwa', ぐぃ: 'gwi', ぐぇ: 'gwe', ぐぉ: 'gwo',
  すぃ: 'si', ずぃ: 'zi', てゅ: 'tyu', でゅ: 'dyu', いぇ: 'ye',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', ゔゃ: 'vya', ゔゅ: 'vyu', ゔょ: 'vyo',
  // ヂャ行 / ヮ 合拗音: missing entries used to leak kana into the Latin output (#287).
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  くゎ: 'kwa', ぐゎ: 'gwa',
  にぇ: 'nye', きぇ: 'kye', ぎぇ: 'gye',
};

const KOREAN_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;
const KOREAN_VOWELS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo',
  'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
] as const;
const KOREAN_FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l',
  'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
] as const;

interface KoreanSyllable {
  initial: number;
  vowel: number;
  final: number;
}

const KOREAN_LIAISON: Record<number, { final: number; initial: number | null }> = {
  1: { final: 0, initial: 0 }, 2: { final: 0, initial: 1 }, 3: { final: 1, initial: 9 },
  4: { final: 0, initial: 2 }, 5: { final: 4, initial: 12 }, 6: { final: 4, initial: null },
  7: { final: 0, initial: 3 }, 8: { final: 0, initial: 5 }, 9: { final: 8, initial: 0 },
  10: { final: 8, initial: 6 }, 11: { final: 8, initial: 7 }, 12: { final: 8, initial: 9 },
  13: { final: 8, initial: 16 }, 14: { final: 8, initial: 17 }, 15: { final: 8, initial: null },
  16: { final: 0, initial: 6 }, 17: { final: 0, initial: 7 }, 18: { final: 17, initial: 9 },
  19: { final: 0, initial: 9 }, 20: { final: 0, initial: 10 },
  22: { final: 0, initial: 12 }, 23: { final: 0, initial: 14 },
  24: { final: 0, initial: 15 }, 25: { final: 0, initial: 16 },
  26: { final: 0, initial: 17 }, 27: { final: 0, initial: null },
};

const LYRIC_SCRIPT_RUNS = /[\u3400-\u4DBF\u4E00-\u9FFF]+|[\u3040-\u30FF\uFF66-\uFF9F]+|[\uAC00-\uD7A3]+|[^\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uFF66-\uFF9F\uAC00-\uD7A3]+/g;
const KATAKANA_PARTS = /[ァ-ヺヽヾー]+|[^ァ-ヺヽヾー]+/g;
const KATAKANA_ATTACH_TO_PREVIOUS = /^[ァィゥェォャュョヮヵヶー]$/;

/**
 * Issue #286 — pronunciation-oriented kana substitutions that apply only in
 * grammatical context, not by literal lookup:
 * - the topic particle は is pronounced わ (koreha → korewa)
 * - the direction particle へ is pronounced え (kyouhe → kyoue)
 * Both are plain kana, so a literal kana→Latin table can never tell them apart
 * from はな / ふへん; they are decided from the tokenizer's part of speech.
 */
const PARTICLE_READINGS: Record<string, string> = {
  は: 'わ',
  へ: 'え',
};

/** Match a kana-only segment so the particle lookup never touches kanji. */
const KANA_ONLY_RE = /^[\u3041-\u3096\u30A1-\u30FA\u30FC]+$/;

/** kuromoji part of speech marking a Japanese particle (助詞). */
const PARTICLE_POS = '助詞';

/**
 * Whether a segment was tokenized as a Japanese particle. `pos` is optional:
 * annotations persisted before issue #286 have no part of speech, so a missing
 * value counts as "unknown" and keeps today's literal romanization.
 */
export function isParticleSegment(segment: LyricReadingSegment): boolean {
  return segment.pos === PARTICLE_POS;
}

/**
 * Apply particle-only kana readings (は→わ, へ→え) to one segment.
 *
 * `pos` is required — it is the only lexical signal that separates the
 * particles from ordinary words, so legacy segments without it are returned
 * unchanged. The lookup runs on kana only: kanji-backed segments are returned
 * verbatim, so a reading such as 葉/は can never be rewritten. Katakana lyric
 * text (ハ/ヘ) is folded to hiragana first, so those particles romanize to
 * wa/e as well.
 */
export function applyParticleReadings(
  text: string,
  reading: string,
  segment: LyricReadingSegment,
): { text: string; reading: string } {
  if (!isParticleSegment(segment)) return { text, reading };
  const normalize = (value: string) => (
    KANA_ONLY_RE.test(value) ? toHiragana(value).replace(/[はへ]/g, (kana) => PARTICLE_READINGS[kana]) : value
  );
  return { text: normalize(text), reading: normalize(reading) };
}

/** Split mixed lyrics so Japanese, Korean and neutral text can receive independent ruby. */
export function splitLyricScriptRuns(value: string): string[] {
  const normalized = value.normalize('NFC');
  return normalized.match(LYRIC_SCRIPT_RUNS) ?? (normalized ? [normalized] : []);
}

export interface LyricReadingSegment {
  text: string;
  reading: string;
  /** Tokenizer part of speech (`FuriganaSegment.pos`); absent on legacy data. */
  pos?: string;
}

export function isKoreanReadingSegment(value: string): boolean {
  return /^[\uAC00-\uD7A3]+$/.test(value.normalize('NFC'));
}

export function isKatakanaReadingSegment(value: string): boolean {
  return /^[ァ-ヺヽヾー]+$/.test(value.normalize('NFC'));
}

function splitKatakanaMora(value: string): string[] {
  const units: string[] = [];
  for (const character of value) {
    if (KATAKANA_ATTACH_TO_PREVIOUS.test(character) && units.length > 0) {
      units[units.length - 1] += character;
    } else {
      units.push(character);
    }
  }
  return units;
}

function splitBalancedKatakanaRun(value: string, maxRomanizedLength: number): string[] {
  const totalLength = romanizeJapanese(value).length;
  const chunkCount = Math.ceil(totalLength / maxRomanizedLength);
  if (chunkCount <= 1) return [value];

  const units = splitKatakanaMora(value);
  const targetLength = totalLength / chunkCount;
  const chunks: string[] = [];
  let current = '';

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    current += unit;
    const nextUnit = units[index + 1] ?? '';
    const ambiguousNBoundary = current.endsWith('ン') && /^[アイウエオヤユヨ]/.test(nextUnit);
    if (chunks.length < chunkCount - 1
      && !current.endsWith('ッ')
      && !ambiguousNBoundary
      && romanizeJapanese(current).length >= targetLength) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split long Katakana annotations into balanced ruby units without changing visible text. */
export function splitLongKatakanaForRuby(value: string, maxRomanizedLength = 12): string[] {
  const normalized = value.normalize('NFC');
  return (normalized.match(KATAKANA_PARTS) ?? [normalized]).flatMap((part) => (
    isKatakanaReadingSegment(part)
      ? splitBalancedKatakanaRun(part, maxRomanizedLength)
      : [part]
  ));
}

/** Preserve real separators while joining Korean pieces that upstream tokenizers split mid-word. */
export function normalizeFuriganaSegments(segments: readonly LyricReadingSegment[]): LyricReadingSegment[] {
  const result: LyricReadingSegment[] = [];
  for (const segment of segments) {
    const scriptParts = segment.reading
      ? [{ text: segment.text.normalize('NFC'), reading: segment.reading }]
      : splitLyricScriptRuns(segment.text).map((text) => ({ text, reading: '' }));
    const parts = scriptParts.flatMap((part) => (
      !part.reading && isKatakanaReadingSegment(part.text)
        ? splitLongKatakanaForRuby(part.text).map((text) => ({ text, reading: '' }))
        : [part]
    ));

    for (const part of parts) {
      const previous = result.at(-1);
      if (previous && !previous.reading && !part.reading
        && isKoreanReadingSegment(previous.text) && isKoreanReadingSegment(part.text)) {
        previous.text += part.text;
      } else {
        result.push(part);
      }
    }
  }
  return result;
}

function toHiragana(value: string): string {
  const normalizedKana = value
    .replace(/[\uFF66-\uFF9F]+/g, (kana) => kana.normalize('NFKC'))
    // ゞ/ヾ are a single voiced iteration mark (kana + U+3099); dropping the
    // combining mark keeps them in the silent BASIC bucket instead of leaking.
    .replace(/([\u309d\u30fd])\u3099/g, '$1');
  return [...normalizedKana].map((character) => {
    const code = character.charCodeAt(0);
    // 0x30F7-0x30FA (ヷヸヹヺ) have no Hiragana counterpart: expand them into
    // the matching ゔ digraph so the ゔ series reading (va/vi/ve/vo) applies.
    if (code >= 0x30f7 && code <= 0x30fa) {
      return '\u3094' + '\u3041\u3043\u3047\u3049'[code - 0x30f7];
    }
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCharCode(code - 0x60)
      : character;
  }).join('');
}

function lastVowel(value: string): string {
  const match = value.match(/[aeiou](?!.*[aeiou])/);
  return match?.[0] ?? '';
}

/**
 * Small kana that never stand alone in a syllable table.
 *
 * They either form a digraph with the preceding kana (きゃ) or fall back to the
 * reading of their full-size counterpart (ゃ→ya, ぁ→a, ゎ→wa).
 */
const SMALL_KANA = 'ゃゅょぁぃぅぇぉゎ';

/** Full-size kana used as the fallback reading of each small kana. */
const SMALL_KANA_FULL: Record<string, string> = {
  ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゎ: 'わ',
};

/** Kana block (U+3040-U+30FF), including the combining voiced sound marks. */
const KANA_CHARACTER = /[\u3040-\u30ff]/;

/** Kana marks with no reading of their own (iteration marks, dakuten, middle dot). */
const SILENT_KANA = new Set(['\u309d', '\u309e', '\u309b', '\u309c', '\u30fb', '\u30fd', '\u30fe']);

function warnUnmappedKana(character: string): void {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  console.warn(
    `[romaji] unmapped character "${character}" (U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')})`,
  );
}

/**
 * Rebuild the syllable that ends at `index` with the small kana's reading.
 *
 * The small kana is pronounced like its full-size counterpart (ゃ→ya), so the
 * preceding syllable keeps its consonant onset and the small kana supplies the
 * rest: す+ゃ→s+ya=sya, く+ゎ→k+wa=kwa, ふぃ+ぇ→f+e=fe.
 */
function mergeSmallKana(input: string, index: number): string | null {
  const small = input[index];
  const full = SMALL_KANA_FULL[small];
  const smallReading = full ? BASIC[full] : undefined;
  if (!smallReading) return null;

  const previous = index > 0 ? input[index - 1] : '';
  const previousPair = index > 1 ? input.slice(index - 2, index) : '';
  if (previous === 'っ') return smallReading;

  // Prefer the digraph immediately before the small kana (ふぃ + ぇ), then a
  // single leading kana (く + ゎ), then the kana before that (ん + ぁ).
  const base = [COMBOS[previousPair], COMBOS[previous], BASIC[previous], BASIC[input[index - 2]]]
    .find((candidate) => candidate !== undefined);
  if (!base) return null;
  // ん already romanizes as "n"; the caller adds the syllable separator.
  if (base === 'n') return `n${smallReading}`;
  const onset = base.match(/^([^aeiou]*)/)?.[1] ?? '';
  return onset + smallReading;
}

function isSmallKana(character: string): boolean {
  return SMALL_KANA.includes(character);
}

/**
 * Convert kana readings to a predictable Hepburn-style Latin representation.
 *
 * The output only ever contains Latin letters and punctuation: small kana that
 * are missing from the tables merge into the preceding syllable, and any other
 * unreadable kana is dropped with a warning (issue #287).
 */
export function romanizeJapanese(value: string): string {
  const input = toHiragana(value);
  let output = '';
  let geminate = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === 'っ') {
      geminate = true;
      continue;
    }
    if (character === 'ー') {
      output += lastVowel(output);
      continue;
    }
    if (SILENT_KANA.has(character)) {
      geminate = false;
      continue;
    }

    const pair = input.slice(index, index + 2);
    const previous = index > 0 ? input[index - 1] : '';
    let consumed = 1;
    let syllable: string | undefined = COMBOS[pair];

    if (syllable) {
      consumed = 2;
    } else if (isSmallKana(character) && previous && output) {
      // The preceding syllable is already in the output, so rebuild it with this
      // small kana's reading: ふぃ + ぇ → fe. A run of small kana (ゃゅょ) has no
      // syllable to merge into, so each of them keeps its own reading.
      const previousSyllable = COMBOS[input.slice(index - 2, index)]
        ?? (isSmallKana(previous) ? undefined : BASIC[previous]);
      const merged = previousSyllable ? mergeSmallKana(input, index) : null;
      if (previousSyllable && merged) {
        output = output.slice(0, -previousSyllable.length);
        syllable = merged;
      } else {
        syllable = BASIC[character];
      }
    } else if (isSmallKana(pair[1] ?? '') && !isSmallKana(character)) {
      // The digraph is missing from the tables: merge the small kana into the
      // syllable before it (く+ゎ → kwa) so it never stands alone or leaks kana.
      syllable = mergeSmallKana(input, index + 1) ?? undefined;
      if (syllable) {
        consumed = 2;
        if (isKana(previous) && BASIC[previous] === undefined) warnUnmappedKana(pair);
      } else {
        syllable = BASIC[character];
      }
    } else {
      syllable = BASIC[character];
    }
    if (syllable) index += consumed - 1;

    if (!syllable) {
      // Last resort: never emit kana. Every kana with a reading is covered by
      // the tables above, so a hit here means the kana is unknown and dropped.
      if (isKana(character)) warnUnmappedKana(character);
      else output += character;
      geminate = false;
      continue;
    }

    if (geminate) {
      const consonant = syllable.startsWith('ch')
        ? 't'
        : syllable.match(/^[bcdfghjklmnpqrstvwxyz]/)?.[0];
      if (consonant) output += consonant;
      geminate = false;
    }

    if (output.endsWith('n') && /^[aeiouy]/.test(syllable)) output += "'";
    output += syllable;
  }

  return output;
}

function isKana(character: string): boolean {
  return KANA_CHARACTER.test(character);
}

function decomposeKoreanSyllable(character: string): KoreanSyllable | null {
  const offset = character.charCodeAt(0) - 0xac00;
  if (offset < 0 || offset >= 11172) return null;
  return {
    initial: Math.floor(offset / 588),
    vowel: Math.floor((offset % 588) / 28),
    final: offset % 28,
  };
}

function applyKoreanSoundChanges(source: KoreanSyllable[]): KoreanSyllable[] {
  const syllables = source.map((syllable) => ({ ...syllable }));
  const kFinals = new Set([1, 2, 3, 9, 24]);
  const tFinals = new Set([7, 19, 20, 22, 23, 25, 27]);
  const pFinals = new Set([17, 18, 26]);

  for (let index = 0; index < syllables.length - 1; index += 1) {
    const current = syllables[index];
    const next = syllables[index + 1];
    if (current.final === 0) continue;

    if (next.initial === 11) {
      if (next.vowel === 20 && (current.final === 7 || current.final === 25)) {
        const final = current.final;
        current.final = 0;
        next.initial = final === 7 ? 12 : 14;
        continue;
      }
      const liaison = KOREAN_LIAISON[current.final];
      if (liaison) {
        current.final = liaison.final;
        if (liaison.initial !== null) next.initial = liaison.initial;
      }
      continue;
    }

    if ((current.final === 27 || current.final === 6 || current.final === 15)
      && (next.initial === 0 || next.initial === 3 || next.initial === 12)) {
      current.final = current.final === 6 ? 4 : current.final === 15 ? 8 : 0;
      next.initial = next.initial === 0 ? 15 : next.initial === 3 ? 16 : 14;
      continue;
    }

    if (next.initial === 18) {
      if (kFinals.has(current.final)) { current.final = 0; next.initial = 15; continue; }
      if (tFinals.has(current.final)) { current.final = 0; next.initial = 16; continue; }
      if (pFinals.has(current.final)) { current.final = 0; next.initial = 17; continue; }
    }

    if (current.final === 4 && next.initial === 5) {
      current.final = 8;
      next.initial = 5;
      continue;
    }
    if (current.final === 8 && next.initial === 2) {
      next.initial = 5;
      continue;
    }
    if ((current.final === 16 || current.final === 21) && next.initial === 5) {
      next.initial = 2;
      continue;
    }
    if (next.initial === 5 && kFinals.has(current.final)) {
      current.final = 21;
      next.initial = 2;
      continue;
    }
    if (next.initial === 5 && pFinals.has(current.final)) {
      current.final = 16;
      next.initial = 2;
      continue;
    }

    if (next.initial === 2 || next.initial === 6) {
      if (kFinals.has(current.final)) current.final = 21;
      else if (tFinals.has(current.final)) current.final = 4;
      else if (pFinals.has(current.final)) current.final = 16;
    }
  }

  return syllables;
}

function romanizeKoreanRun(source: KoreanSyllable[]): string {
  const syllables = applyKoreanSoundChanges(source);
  return syllables
    .map((syllable, index) => {
      const initial = syllable.initial === 5 && index > 0 && syllables[index - 1].final === 8
        ? 'l'
        : KOREAN_INITIALS[syllable.initial];
      return initial + KOREAN_VOWELS[syllable.vowel] + KOREAN_FINALS[syllable.final];
    })
    .join('');
}

/** Convert Hangul syllables to pronunciation-oriented Revised Romanization. */
export function romanizeKorean(value: string): string {
  let output = '';
  let run: KoreanSyllable[] = [];
  const flush = () => {
    if (run.length > 0) output += romanizeKoreanRun(run);
    run = [];
  };

  for (const character of value.normalize('NFC')) {
    const syllable = decomposeKoreanSyllable(character);
    if (syllable) run.push(syllable);
    else {
      flush();
      output += character;
    }
  }
  flush();
  return output;
}

/** Romanize Japanese kana and Korean Hangul in the same lyric fragment. */
export function romanizeLyricsReading(value: string): string {
  return romanizeKorean(romanizeJapanese(value));
}

/** Resolve the ruby text for one lyric segment without replacing its visible source text. */
export function resolveFuriganaReading(
  text: string,
  reading: string,
  romanize: boolean,
  scheme: ReadingScheme = 'ja-kana',
  segment?: LyricReadingSegment,
): string {
  if (scheme === 'yue-jyutping') return reading;
  // Issue #286: particles are romanized by pronunciation (は→wa, へ→e). The
  // lexical part of speech is only available when the caller passes the whole
  // segment; legacy annotations (and the pre-#286 call shape) keep the literal
  // reading because no part of speech can be assumed.
  const particle = segment ? applyParticleReadings(text, reading, segment) : { text, reading };
  const source = particle.reading || (romanize ? particle.text : '');
  if (!source) return '';
  const resolved = romanize ? romanizeLyricsReading(source) : source;
  return resolved === particle.text ? '' : resolved;
}
