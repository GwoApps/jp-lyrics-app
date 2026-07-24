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

const HANGUL_BASIC: Record<string, string> = {
  あ: '아', い: '이', う: '우', え: '에', お: '오',
  か: '카', き: '키', く: '쿠', け: '케', こ: '코',
  が: '가', ぎ: '기', ぐ: '구', げ: '게', ご: '고',
  さ: '사', し: '시', す: '스', せ: '세', そ: '소',
  ざ: '자', じ: '지', ず: '즈', ぜ: '제', ぞ: '조',
  た: '타', ち: '치', つ: '츠', て: '테', と: '토',
  だ: '다', ぢ: '지', づ: '즈', で: '데', ど: '도',
  な: '나', に: '니', ぬ: '누', ね: '네', の: '노',
  は: '하', ひ: '히', ふ: '후', へ: '헤', ほ: '호',
  ば: '바', び: '비', ぶ: '부', べ: '베', ぼ: '보',
  ぱ: '파', ぴ: '피', ぷ: '푸', ぺ: '페', ぽ: '포',
  ま: '마', み: '미', む: '무', め: '메', も: '모',
  や: '야', ゆ: '유', よ: '요',
  ら: '라', り: '리', る: '루', れ: '레', ろ: '로',
  わ: '와', ゐ: '이', ゑ: '에', を: '오',
  ぁ: '아', ぃ: '이', ぅ: '우', ぇ: '에', ぉ: '오',
  ゃ: '야', ゅ: '유', ょ: '요', ゔ: '부',
};

const HANGUL_COMBOS: Record<string, string> = {
  きゃ: '캬', きゅ: '큐', きょ: '쿄',
  ぎゃ: '갸', ぎゅ: '규', ぎょ: '교',
  しゃ: '샤', しゅ: '슈', しょ: '쇼',
  じゃ: '자', じゅ: '주', じょ: '조',
  ちゃ: '차', ちゅ: '추', ちょ: '초',
  にゃ: '냐', にゅ: '뉴', にょ: '뇨',
  ひゃ: '햐', ひゅ: '휴', ひょ: '효',
  びゃ: '뱌', びゅ: '뷰', びょ: '뵤',
  ぴゃ: '퍄', ぴゅ: '퓨', ぴょ: '표',
  みゃ: '먀', みゅ: '뮤', みょ: '묘',
  りゃ: '랴', りゅ: '류', りょ: '료',
  ふぁ: '파', ふぃ: '피', ふぇ: '페', ふぉ: '포', ふゅ: '퓨',
  てぃ: '티', でぃ: '디', とぅ: '투', どぅ: '두',
  うぃ: '위', うぇ: '웨', うぉ: '워',
  しぇ: '셰', じぇ: '제', ちぇ: '체',
  つぁ: '차', つぃ: '치', つぇ: '체', つぉ: '초',
  くぁ: '콰', くぃ: '퀴', くぇ: '퀘', くぉ: '쿼',
  ぐぁ: '과', ぐぃ: '귀', ぐぇ: '궤', ぐぉ: '궈',
  すぃ: '시', ずぃ: '지', てゅ: '튜', でゅ: '듀', いぇ: '예',
  ゔぁ: '바', ゔぃ: '비', ゔぇ: '베', ゔぉ: '보', ゔゅ: '뷰',
};

const HANGUL_LONG_VOWELS: Record<string, string> = {
  a: '아', i: '이', u: '우', e: '에', o: '오',
};

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

function appendHangulFinal(output: string, jongseongIndex: number, fallback: string): string {
  const last = output.at(-1);
  if (!last) return output + fallback;
  const code = last.charCodeAt(0);
  const syllableOffset = code - 0xac00;
  if (syllableOffset >= 0 && syllableOffset < 11172 && syllableOffset % 28 === 0) {
    return output.slice(0, -1) + String.fromCharCode(code + jongseongIndex);
  }
  return output + fallback;
}

/** Convert kana to a readable Hangul approximation while preserving non-kana text. */
export function kanaToHangul(value: string): string {
  const input = toHiragana(value);
  let output = '';
  let previousVowel = '';

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === 'っ') {
      output = appendHangulFinal(output, 19, 'ㅅ');
      continue;
    }
    if (character === 'ん') {
      output = appendHangulFinal(output, 4, 'ㄴ');
      continue;
    }
    if (character === 'ー') {
      output += HANGUL_LONG_VOWELS[previousVowel] || 'ー';
      continue;
    }

    const pair = input.slice(index, index + 2);
    const pairHangul = HANGUL_COMBOS[pair];
    if (pairHangul) {
      output += pairHangul;
      previousVowel = lastVowel(COMBOS[pair] || '');
      index += 1;
      continue;
    }

    const hangul = HANGUL_BASIC[character];
    if (hangul) {
      output += hangul;
      previousVowel = lastVowel(BASIC[character] || '');
    } else {
      output += character;
    }
  }

  return output;
}

export interface FuriganaReadingValue {
  value: string;
  lang: 'ja' | 'en' | 'ko';
}

/** Resolve all enabled ruby rows without replacing the visible Japanese source text. */
export function resolveFuriganaReadings(
  text: string,
  reading: string,
  romanize: boolean,
  hangul: boolean,
): FuriganaReadingValue[] {
  const values: FuriganaReadingValue[] = [];
  const source = reading || text;

  if (reading && reading !== text) values.push({ value: reading, lang: 'ja' });
  if (romanize) {
    const value = romanizeJapanese(source);
    if (value && value !== text && value !== reading) values.push({ value, lang: 'en' });
  }
  if (hangul) {
    const value = kanaToHangul(source);
    if (value && value !== text && value !== reading) values.push({ value, lang: 'ko' });
  }

  return values;
}
