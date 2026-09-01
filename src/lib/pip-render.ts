import type { FuriganaLine, ReadingMode, ReadingScheme } from '@/lib/types';
import {
  isKatakanaReadingSegment,
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
} from '@/lib/romaji';
import { normalizeReadingScheme } from '@/lib/lyrics-reading';
import { escapeHtml } from '@/lib/escape-html';

/** Render the PiP lyrics list HTML for the given reading settings. */
export function renderPipLyricsHtml(
  furiganaLines: FuriganaLine[],
  readingScheme: ReadingScheme | undefined,
  readingMode: ReadingMode,
  romanize: boolean,
  timestamps?: (number | null)[],
): string {
  return furiganaLines.map((line, i) => {
    if (line.segments.length === 0) return `<div class="line empty" data-line="${i}"></div>`;
    const html = normalizeFuriganaSegments(line.segments).map(seg => {
      if (readingMode === 'original') return escapeHtml(seg.text);
      const scheme = normalizeReadingScheme(readingScheme);
      const reading = resolveFuriganaReading(seg.text, seg.reading, romanize, scheme);
      if (!reading) return escapeHtml(seg.text);
      const rubyClass = scheme === 'yue-jyutping'
        ? 'cantonese-reading'
        : romanize && isKoreanReadingSegment(seg.text)
          ? 'korean-word'
          : romanize && isKatakanaReadingSegment(seg.text) ? 'katakana-chunk' : '';
      const className = rubyClass ? ` class="${rubyClass}"` : '';
      const language = scheme === 'yue-jyutping' ? ' lang="yue-Latn"' : '';
      return `<ruby${className}>${escapeHtml(seg.text)}<rp>(</rp><rt${language}>${escapeHtml(reading)}</rt><rp>)</rp></ruby>`;
    }).join('');
    const ts = timestamps?.[i];
    const tsAttr = ts != null ? ` data-ts="${ts}"` : '';
    const tsClass = ts != null ? ' has-ts' : '';
    return `<div class="line${tsClass}" data-line="${i}"${tsAttr}>${html}</div>`;
  }).join('');
}
