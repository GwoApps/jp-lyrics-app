export type JapaneseLexemes = Record<string, Record<string, string[]>>;

// Reversible surface endings, gated by the matched JMdict grammatical class.
// Include bare tokenizer stems: 届か + ない, 溜まっ + た, 黒く, etc.
const GODAN: readonly (readonly [classes: string[], ending: string, a: string, i: string, e: string, o: string, onbin: string, te: string, ta: string])[] = [
  [['v5u'], 'う', 'わ', 'い', 'え', 'お', 'っ', 'って', 'った'],
  [['v5k'], 'く', 'か', 'き', 'け', 'こ', 'い', 'いて', 'いた'],
  [['v5k-s'], 'く', 'か', 'き', 'け', 'こ', 'っ', 'って', 'った'],
  [['v5g'], 'ぐ', 'が', 'ぎ', 'げ', 'ご', 'い', 'いで', 'いだ'],
  [['v5s'], 'す', 'さ', 'し', 'せ', 'そ', 'し', 'して', 'した'],
  [['v5t'], 'つ', 'た', 'ち', 'て', 'と', 'っ', 'って', 'った'],
  [['v5n'], 'ぬ', 'な', 'に', 'ね', 'の', 'ん', 'んで', 'んだ'],
  [['v5b'], 'ぶ', 'ば', 'び', 'べ', 'ぼ', 'ん', 'んで', 'んだ'],
  [['v5m'], 'む', 'ま', 'み', 'め', 'も', 'ん', 'んで', 'んだ'],
  [['v5r', 'v5r-i'], 'る', 'ら', 'り', 'れ', 'ろ', 'っ', 'って', 'った'],
];
const POLITE = ['ます', 'ました', 'ません', 'ませんでした', 'ましょう'];

/** Dictionary POS makes suffix matching evidence of a conjugation, not a guess. */
export function getInflectedJapaneseReadings(surface: string, lexemes: JapaneseLexemes): string[] {
  // Pure kanji nouns such as 過去 must not be misread as an invisible -る stem.
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(surface)) return [];
  const readings = new Set<string>();
  function match(ending: string, base: string, classes: readonly string[], convert?: (reading: string) => string | null) {
    if (!surface.endsWith(ending) || surface.length <= ending.length) return;
    const lemma = (ending ? surface.slice(0, -ending.length) : surface) + base;
    for (const pos of classes) for (const reading of lexemes[lemma]?.[pos] ?? []) {
      const value = convert ? convert(reading) : reading.endsWith(base) ? reading.slice(0, -base.length) + ending : null;
      if (value) readings.add(value);
    }
  }
  for (const [classes, base, a, i, e, o, onbin, te, ta] of GODAN) {
    const forms = new Set([a, i, e, o, onbin, te, ta, a + 'ない', a + 'なかった', e + 'ば', o + 'う', ...POLITE.map(tail => i + tail)]);
    for (const form of forms) match(form, base, classes);
  }
  for (const form of ['', 'て', 'た', 'ない', 'なかった', 'れば', 'よう', 'ろ', 'よ', 'られ', 'られる', 'させ', 'させる', ...POLITE]) {
    match(form, 'る', ['v1', 'v1-s']);
  }
  for (const form of ['く', 'くて', 'かった', 'くない', 'くなかった', 'けれ', 'ければ']) {
    match(form, 'い', ['adj-i']);
    match(form, 'い', ['adj-ix'], reading => reading.endsWith('いい')
      ? reading.slice(0, -2) + 'よ' + form
      : reading.endsWith('い') ? reading.slice(0, -1) + form : null);
  }
  match('と', '', ['adv-to'], reading => reading + 'と');
  for (const ending of ['な', 'に', 'で']) match(ending, '', ['adj-na'], reading => reading + ending);
  const irregular: ReadonlyArray<readonly [surfaceEnding: string, kuru: string, suru: string]> = [
    ['て', 'きて', 'して'], ['た', 'きた', 'した'], ['ない', 'こない', 'しない'],
    ['なかった', 'こなかった', 'しなかった'], ['ます', 'きます', 'します'],
    ['ました', 'きました', 'しました'], ['ません', 'きません', 'しません'],
    ['ませんでした', 'きませんでした', 'しませんでした'], ['ましょう', 'きましょう', 'しましょう'],
    ['', 'き', 'し'],
  ];
  for (const [form, kuru, suru] of irregular) {
    match(form, 'る', ['vk'], reading => reading.endsWith('くる') ? reading.slice(0, -2) + kuru : null);
    match(suru, 'する', ['vs-i', 'vs-s'], reading => reading.endsWith('する') ? reading.slice(0, -2) + suru : null);
    // JMdict often stores a verbal noun as 勉強 (vs), not 勉強する.
    match(suru, '', ['vs', 'vs-i', 'vs-s'], reading => reading + suru);
    match(form, 'る', ['vs-i', 'vs-s'], reading => reading.endsWith('する') ? reading.slice(0, -2) + suru : null);
  }
  return [...readings];
}
