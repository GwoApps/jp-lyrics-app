import type { FuriganaSegment, FuriganaLine } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Kuroshiro = require('kuroshiro').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

let kuroshiroInstance: InstanceType<typeof Kuroshiro> | null = null;

async function getKuroshiro() {
  if (kuroshiroInstance) return kuroshiroInstance;
  kuroshiroInstance = new Kuroshiro();
  await kuroshiroInstance.init(new KuromojiAnalyzer());
  return kuroshiroInstance;
}

/**
 * Compound reading corrections for number + counter combinations.
 * kuromoji tokenizes these as separate morphemes, giving wrong per-character readings.
 * Key: compound text, Value: correct hiragana reading.
 */
const COMPOUND_READINGS: Record<string, string> = {
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
  '一色': 'いっしょく', '三色': 'さんしょく', '五色': 'ごしき',
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

// Kanji digit map
const DIGITS: Record<string, string> = {
  '一': 'いち', '二': 'に', '三': 'さん', '四': 'よん/し',
  '五': 'ご', '六': 'ろく', '七': 'なな/しち', '八': 'はち',
  '九': 'きゅう/く', '十': 'じゅう', '何': 'なん', '百': 'ひゃく',
  '千': 'せん', '万': 'まん', '億': 'おく', '兆': 'ちょう',
};

/** Check if a character is a kanji (CJK Unified Ideographs) */
function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x20000 && code <= 0x2A6DF);
}

/**
 * Post-process furigana segments to fix number+counter compounds.
 * kuromoji tokenizes 一人 as 一+人, giving wrong per-character readings.
 * This merges adjacent single-kanji segments and applies corrected readings.
 */
function fixCompoundReadings(segments: FuriganaSegment[]): FuriganaSegment[] {
  if (segments.length < 2) return segments;

  const result: FuriganaSegment[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];

    // Look for runs of single-kanji segments that could be compounds
    if (seg.text.length === 1 && isKanji(seg.text) && seg.reading) {
      // Try progressively longer compounds (2-4 chars)
      let bestMerge: { text: string; reading: string; endIdx: number } | null = null;

      for (let len = 4; len >= 2; len--) {
        if (i + len > segments.length) continue;

        // Check if all segments in range are single-kanji with readings
        const allSingleKanji = segments.slice(i, i + len).every(
          (s) => s.text.length === 1 && isKanji(s.text) && s.reading
        );
        if (!allSingleKanji) continue;

        const compound = segments.slice(i, i + len).map((s) => s.text).join('');
        const corrected = COMPOUND_READINGS[compound];
        if (corrected) {
          bestMerge = { text: compound, reading: corrected, endIdx: i + len };
          break; // prefer longest match
        }
      }

      if (bestMerge) {
        result.push({ text: bestMerge.text, reading: bestMerge.reading });
        i = bestMerge.endIdx;
        continue;
      }
    }

    result.push(seg);
    i++;
  }

  return result;
}

/**
 * Convert raw Japanese lyrics (with kanji) into furigana-annotated structure.
 * Each line becomes an array of segments with surface text and hiragana reading.
 */
export async function convertToFurigana(rawLyrics: string): Promise<FuriganaLine[]> {
  const kuroshiro = await getKuroshiro();
  const lines = rawLyrics.split('\n');
  const result: FuriganaLine[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      result.push({ segments: [] });
      continue;
    }

    const html = await kuroshiro.convert(line, {
      mode: 'furigana',
      to: 'hiragana',
    });

    let segments = parseFuriganaHtml(html);
    segments = fixCompoundReadings(segments);
    result.push({ segments });
  }

  return result;
}

/**
 * Parse HTML like: <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>
 * into FuriganaSegment[]
 */
function parseFuriganaHtml(html: string): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const rubyRegex = /<ruby>(.*?)<rp>\(<\/rp><rt>(.*?)<\/rt><rp>\)<\/rp><\/ruby>/g;
  let lastIndex = 0;
  let match;

  while ((match = rubyRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const plain = html.slice(lastIndex, match.index);
      if (plain) {
        segments.push({ text: plain, reading: '' });
      }
    }
    const surface = match[1];
    const reading = match[2];
    segments.push({
      text: surface,
      reading: surface === reading ? '' : reading,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    const remaining = html.slice(lastIndex);
    if (remaining) {
      segments.push({ text: remaining, reading: '' });
    }
  }

  if (segments.length === 0 && html) {
    const clean = html.replace(/<[^>]*>/g, '');
    if (clean) {
      segments.push({ text: clean, reading: '' });
    }
  }

  return segments;
}
