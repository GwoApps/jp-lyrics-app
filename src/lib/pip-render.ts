import type { FuriganaLine, ReadingMode, ReadingScheme } from '@/lib/types';
import {
  isKatakanaReadingSegment,
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
} from '@/lib/romaji';
import { normalizeReadingScheme, sourceLyricsLang } from '@/lib/lyrics-reading';
import { resolveTranslationLang } from '@/lib/target-lang';
import { escapeHtml } from '@/lib/escape-html';

interface PipRenderOptions {
  /**
   * Per-line translations, index-aligned with `furiganaLines`. Lines without a
   * translation (missing entry, blank string) render source-only.
   */
  translations?: (string | null)[];
  /** BCP-47 tag of the translation text (`songs.lyrics_translation_lang`). */
  translationLang?: string | null;
  /**
   * Placeholder shown under source lines that have no translation yet, so a
   * partially translated song reads the same in PiP as on the detail page
   * (issue #100). Callers pass the already-localized `song.untranslatedHint`.
   */
  untranslatedHint?: string;
}

/** Render the PiP lyrics list HTML for the given reading settings. */
export function renderPipLyricsHtml(
  furiganaLines: FuriganaLine[],
  readingScheme: ReadingScheme | undefined,
  readingMode: ReadingMode,
  romanize: boolean,
  timestamps?: (number | null)[],
  options: PipRenderOptions = {},
): string {
  const { translations, translationLang, untranslatedHint } = options;
  const scheme = normalizeReadingScheme(readingScheme);
  // Issue #274: annotate both sides of the lyric pair with the language they
  // are actually in — the source from the reading scheme, the translation from
  // `songs.lyrics_translation_lang` — so screen readers and the per-language
  // font rules do not treat a Chinese translation as Japanese.
  const sourceLanguage = sourceLyricsLang(readingScheme);
  const translationLanguage = resolveTranslationLang(translationLang);

  return furiganaLines.map((line, i) => {
    if (line.segments.length === 0) return `<div class="line empty" data-line="${i}"></div>`;
    const html = normalizeFuriganaSegments(line.segments).map(seg => {
      if (readingMode === 'original') return escapeHtml(seg.text);
      const reading = resolveFuriganaReading(seg.text, seg.reading, romanize, scheme, seg);
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
    // Same typography as `FuriganaLine`: the negative top margin pulls the
    // translation up into the source line's half-leading and the padding below
    // restores the gap to the next line. The hint is UI chrome, not lyric
    // content, so it stays in the document language and is hidden from AT.
    const translation = translations?.[i]?.trim();
    const translationBlock = translation
      ? `<div class="translation" lang="${translationLanguage}">${escapeHtml(translation)}</div>`
      : untranslatedHint
        ? `<div class="translation untranslated-hint" aria-hidden="true">${escapeHtml(untranslatedHint)}</div>`
        : '';
    return `<div class="line${tsClass}${translationBlock ? ' has-translation' : ''}" data-line="${i}"${tsAttr}><span class="line-source" lang="${sourceLanguage}">${html}</span>${translationBlock}</div>`;
  }).join('');
}
