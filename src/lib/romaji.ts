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
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', ゔゅ: 'vyu',
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
      const consonant = syllable.match(/^[bcdfghjklmnpqrstvwxyz]/)?.[0];
      if (consonant) output += consonant;
      geminate = false;
    }

    if (output.endsWith('n') && /^[aeiouy]/.test(syllable)) output += "'";
    output += syllable;
  }

  return output;
}
