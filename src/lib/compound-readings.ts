/**
 * Compound reading corrections for number + counter combinations.
 * kuromoji tokenizes these as separate morphemes, giving wrong per-character readings.
 * Key: compound text, Value: correct hiragana reading.
 */
export const COMPOUND_READINGS: Record<string, string> = {
  // 人 — irregular kun'yomi
  '一人': 'ひとり', '二人': 'ふたり', '三人': 'さんにん',
  '何人': 'なんにん',
  // つ — general counter
  '一つ': 'ひとつ', '二つ': 'ふたつ', '三つ': 'みっつ',
  '四つ': 'よっつ', '五つ': 'いつつ', '六つ': 'むっつ',
  '七つ': 'ななつ', '八つ': 'やっつ', '九つ': 'ここのつ',
  '十': 'とお', '二十': 'はたち',
  // 日 — day counter (irregular)
  '一日': 'ついたち', '二日': 'ふつか', '三日': 'みっか',
  '四日': 'よっか', '五日': 'いつか', '六日': 'むいか',
  '七日': 'なのか', '八日': 'ようか', '九日': 'ここのか',
  '十日': 'とおか', '十四日': 'じゅうよっか', '二十日': 'はつか',
  // 本 — long thin counter (rendaku / gemination)
  '一本': 'いっぽん', '三本': 'さんぼん', '六本': 'ろっぽん',
  '八本': 'はっぽん', '十本': 'じゅっぽん',
  // 杯 — cup/glass counter
  '一杯': 'いっぱい', '三杯': 'さんばい', '六杯': 'ろっぱい',
  '八杯': 'はっぱい', '十杯': 'じゅっぱい', '何杯': 'なんばい',
  // 匹 — small animal counter
  '一匹': 'いっぴき', '三匹': 'さんびき', '六匹': 'ろっぴき',
  '八匹': 'はっぴき', '十匹': 'じゅっぴき', '何匹': 'なんびき',
  // 歩 — step counter
  '一步': 'いっぽ', '三步': 'さんぽ', '六步': 'ろっぽ',
  '八步': 'はっぽ', '十步': 'じゅっぽ',
  '一歩': 'いっぽ', '三歩': 'さんぽ', '六歩': 'ろっぽ',
  '八歩': 'はっぽ', '十歩': 'じゅっぽ',
  // 分 — minute counter
  '一分': 'いっぷん', '三分': 'さんぷん', '四分': 'よんぷん',
  '六分': 'ろっぷん', '八分': 'はっぷん', '十分': 'じゅっぷん',
  '何分': 'なんぷん',
  // 階 — floor counter
  '一階': 'いっかい', '三階': 'さんがい', '六階': 'ろっかい',
  '八階': 'はっかい', '十階': 'じゅっかい', '何階': 'なんがい',
  // 歳 — age counter
  '一歳': 'いっさい', '八歳': 'はっさい', '十歳': 'じゅっさい',
  '何歳': 'なんさい',
  // 通 — letter/phone call counter
  '一通': 'いっつう', '三通': 'さんつう', '六通': 'ろっつう',
  '八通': 'はっつう', '十通': 'じゅうつう',
  // 軒 — house counter
  '一軒': 'いっけん', '三軒': 'さんげん', '六軒': 'ろっけん',
  '八軒': 'はっけん', '十軒': 'じゅっけん', '何軒': 'なんげん',
  // 頭 — large animal counter
  '一頭': 'いっとう', '三頭': 'さんとう', '六頭': 'ろっとう',
  '八頭': 'はっとう', '十頭': 'じゅっとう',
  // 年 — year
  '一年': 'いちねん', '何年': 'なんねん',
  // 時 — hour / o'clock
  '一時': 'いちじ', '四時': 'よじ', '七時': 'しちじ',
  '九時': 'くじ', '何時': 'なんじ',
  // 月 — month
  '一月': 'いちがつ', '四月': 'しがつ', '七月': 'しちがつ',
  '九月': 'くがつ', '何月': 'なんがつ',
  // 台 — machine counter
  '一台': 'いちだい', '何台': 'なんだい',
  // 枚 — flat object counter
  '一枚': 'いちまい', '何枚': 'なんまい',
  // 回 — time/occurrence counter
  '一回': 'いっかい', '何回': 'なんかい',
  // 個 — small object counter
  '一個': 'いっこ', '三個': 'さんこ', '六個': 'ろっこ',
  '八個': 'はっこ', '十個': 'じゅっこ', '何個': 'なんこ',
  // 冊 — book counter
  '一冊': 'いっさつ', '何冊': 'なんさつ',
  // 着 — clothing counter
  '一着': 'いっちゃく', '何着': 'なんちゃく',
  // 組 — set/group counter
  '一組': 'いちくみ', '何組': 'なんくみ',
  // 番 — number/ordinal
  '一番': 'いちばん', '何番': 'なんばん',
  // 倍 — times/double
  '一倍': 'いちばい', '何倍': 'なんばい',
  // 色 — color counter
  '一色': 'いっしょく', '三色': 'さんしき', '五色': 'ごしき',
  // 種 — kind/type
  '一種': 'いっしゅ', '三種': 'さんしゅ', '何種': 'なんしゅ',
  // 里 — ri (distance)
  '一里': 'いちり',
  // 口 — bite/sip
  '一口': 'ひとくち', '三口': 'みくち',
  // 言 — word
  '一言': 'ひとこと', '二言': 'ふたこと',
  // 度 — degree/time
  '一度': 'いちど', '何度': 'なんど',
  // 人前 — servings
  '一人前': 'いちにんまえ',
};

/** Check if a character is a kanji (CJK Unified Ideographs) */
export function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x20000 && code <= 0x2A6DF);
}

/** Convert katakana to hiragana */
export function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}
