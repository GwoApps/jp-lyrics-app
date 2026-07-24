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
  ゔ: 'vu',
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
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', ゔゅ: 'vyu',
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

/** Split mixed lyrics so Japanese, Korean and neutral text can receive independent ruby. */
export function splitLyricScriptRuns(value: string): string[] {
  const normalized = value.normalize('NFC');
  return normalized.match(LYRIC_SCRIPT_RUNS) ?? (normalized ? [normalized] : []);
}

export interface LyricReadingSegment {
  text: string;
  reading: string;
}

export function isKoreanReadingSegment(value: string): boolean {
  return /^[\uAC00-\uD7A3]+$/.test(value.normalize('NFC'));
}

/** Preserve real separators while joining Korean pieces that upstream tokenizers split mid-word. */
export function normalizeFuriganaSegments(segments: readonly LyricReadingSegment[]): LyricReadingSegment[] {
  const result: LyricReadingSegment[] = [];
  for (const segment of segments) {
    const parts = segment.reading
      ? [{ text: segment.text.normalize('NFC'), reading: segment.reading }]
      : splitLyricScriptRuns(segment.text).map((text) => ({ text, reading: '' }));

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
  const normalizedKana = value.replace(/[\uFF66-\uFF9F]+/g, (kana) => kana.normalize('NFKC'));
  return [...normalizedKana].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCharCode(code - 0x60)
      : character;
  }).join('');
}

function lastVowel(value: string): string {
  const match = value.match(/[aeiou](?!.*[aeiou])/);
  return match?.[0] ?? '';
}

/** Convert kana readings to a predictable Hepburn-style Latin representation. */
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

    const pair = input.slice(index, index + 2);
    let syllable = COMBOS[pair];
    if (syllable) index += 1;
    else syllable = BASIC[character];

    if (!syllable) {
      output += character;
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
export function resolveFuriganaReading(text: string, reading: string, romanize: boolean): string {
  const source = reading || (romanize ? text : '');
  if (!source) return '';
  const resolved = romanize ? romanizeLyricsReading(source) : source;
  return resolved === text ? '' : resolved;
}
