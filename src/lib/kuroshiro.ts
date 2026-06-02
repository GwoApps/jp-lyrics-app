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

    const segments = parseFuriganaHtml(html);
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
