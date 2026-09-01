/**
 * Shared lyrics-export rendering (pure functions, no server/runtime deps).
 *
 * Used by the export API route (`src/app/api/songs/[id]/export/route.ts`) and
 * unit-tested in `src/lib/lyrics-export.test.ts`. Rendering stays in sync with
 * the detail page by reusing the same reading helpers (`romaji.ts`) and the
 * translation alignment from `share-card.ts`.
 */

import type { FuriganaLine, ReadingScheme } from './types.ts';
import { normalizeFuriganaSegments, resolveFuriganaReading } from './romaji.ts';
import { parseTranslationCache } from './translation/parse.ts';
import { extractLrcMetadata, isLrcMetadataLine } from './lrc.ts';

export type ExportFormat = 'text' | 'lrc' | 'html';

/** Furigana/reading option applied to `.txt` and `.html` exports. */
export type ExportReadingMode = 'none' | 'furigana' | 'romaji';

export interface ExportSongData {
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_synced: string;
  lyrics_furigana: string;
  lyrics_translation: string;
  reading_scheme: ReadingScheme;
}

export interface ExportOptions {
  format: ExportFormat;
  /** When true the translated line is paired with each source line. */
  includeTranslation: boolean;
  /**
   * Reading mode for `.txt` / `.html`. `.lrc` always emits the raw synced
   * timeline and ignores this option; when `includeTranslation` is set it
   * additionally appends a translated line after each timed row (same timestamp).
   */
  reading?: ExportReadingMode;
}

export interface ExportResult {
  body: string;
  contentType: string;
  extension: string;
}

/**
 * True when a string contains no meaningful content. Trims invisible
 * whitespace (regular spaces, Unicode spaces, zero-width characters, tabs,
 * line breaks, …) so `'  '`, `'\u00a0'`, `'\u200b'` … are all treated as empty.
 */
export function isEmptyAfterTrim(value: string | null | undefined): boolean {
  return !value || value.replace(/[\p{Z}\p{Cf}\s]/gu, '').length === 0;
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

/** Parse the stored furigana JSON array (aligned to `lyrics_raw` lines). */
export function parseFuriganaLines(value: string): FuriganaLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FuriganaLine =>
      Boolean(item && typeof item === 'object' && Array.isArray((item as FuriganaLine).segments)));
  } catch {
    return [];
  }
}

/**
 * Parse the stored translation JSON array index-aligned to `lyrics_raw`
 * lines. Non-string entries become '' at their original index (never
 * filtered) so later lines never shift.
 */
export function parseTranslations(value: string): string[] {
  return parseTranslationCache(value);
}

/** Render one furigana line to HTML, honouring the reading mode. */
export function renderFuriganaLineToHtml(
  line: FuriganaLine,
  readingMode: ExportReadingMode,
  readingScheme: ReadingScheme,
): string {
  if (line.segments.length === 0) return '<p class="empty">&nbsp;</p>';
  const inner = normalizeFuriganaSegments(line.segments).map((seg) => {
    if (readingMode === 'none') return escapeHtml(seg.text);
    const reading = resolveFuriganaReading(seg.text, seg.reading, readingMode === 'romaji', readingScheme);
    if (!reading) return escapeHtml(seg.text);
    const language = readingScheme === 'yue-jyutping' ? ' lang="yue-Latn"' : '';
    return `<ruby>${escapeHtml(seg.text)}<rp>(</rp><rt${language}>${escapeHtml(reading)}</rt><rp>)</rp></ruby>`;
  }).join('');
  return `<p>${inner}</p>`;
}

/** Render one plain (unannotated) source line to HTML. */
export function renderPlainLineToHtml(line: string): string {
  return `<p>${line ? escapeHtml(line) : '&nbsp;'}</p>`;
}

/** Regex matching the full leading timestamp prefix of one synced LRC row. */
const LRC_LEADING_TIMESTAMPS_RE = /^(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/;

/**
 * Append a translation line after each timed lyric row, reusing the exact same
 * timestamp prefix so players keep the highlight synchronized. Translations are
 * index-aligned to `lyrics_raw`; synced rows are paired with non-empty source
 * lines in order (blank separator lines carry no translation and do not consume
 * a synced row). Rows without a translation are left untouched so no redundant
 * blank line is emitted.
 */
function appendLrcTranslations(lyrics: string, translations: string[], rawLyrics: string): string {
  const sourceLineIndexes: number[] = [];
  (rawLyrics ?? '').split('\n').forEach((line, index) => {
    if (line.trim()) sourceLineIndexes.push(index);
  });

  let lyricRow = 0;
  return lyrics.split('\n').map((raw) => {
    const trimmed = raw.trim();
    // Metadata tags ([ti:]/[ar:]/…) and blank lines are never lyric rows.
    if (!trimmed || isLrcMetadataLine(trimmed)) return raw;
    const prefix = trimmed.match(LRC_LEADING_TIMESTAMPS_RE)?.[0] ?? '';
    const text = trimmed.slice(prefix.length).trim();
    // Untimed row (e.g. an unmarkable line) or a timestamp with no text: keep
    // it as-is — there is no reliable index to pair, so no translation row.
    if (!prefix || !text) return raw;
    const sourceIndex = sourceLineIndexes[lyricRow];
    lyricRow += 1;
    const translation = sourceIndex != null ? translations[sourceIndex]?.trim() : '';
    if (!translation) return raw;
    return `${raw}\n${prefix}${translation}`;
  }).join('\n');
}

/** Emit a `.txt` document (original / furigana / romaji with optional translations). */
export function buildTextExport(
  song: ExportSongData,
  includeTranslation: boolean,
  readingMode: ExportReadingMode,
): string {
  const furiganaLines = parseFuriganaLines(song.lyrics_furigana);
  const translations = parseTranslations(song.lyrics_translation);
  const lines: string[] = [];
  const rawLines = song.lyrics_raw.split('\n');

  rawLines.forEach((rawLine, index) => {
    const furiganaLine = furiganaLines[index];
    const source = furiganaLine && furiganaLine.segments.length > 0 && readingMode !== 'none'
      ? (() => {
          const parts = furiganaLine.segments.map((seg) => {
            if (readingMode === 'furigana') return seg.reading || seg.text;
            const reading = resolveFuriganaReading(seg.text, seg.reading, true, song.reading_scheme);
            return reading || seg.text;
          });
          if (readingMode !== 'romaji') return parts.join('');
          // Space-separate romanized word segments for readability while
          // keeping punctuation glued to the preceding word.
          return parts
            .join(' ')
            .replace(/\s+([\p{P}\p{S}])/gu, '$1')
            .trim();
        })()
      : rawLine;
    lines.push(source);
    if (includeTranslation && source.trim()) {
      const translation = translations[index]?.trim();
      if (translation) lines.push(translation);
    }
  });

  return lines.join('\n');
}

/** Emit a `.html` document (furigana/romaji ruby with optional translations). */
export function buildHtmlExport(
  song: ExportSongData,
  includeTranslation: boolean,
  readingMode: ExportReadingMode,
): string {
  const furiganaLines = parseFuriganaLines(song.lyrics_furigana);
  const translations = parseTranslations(song.lyrics_translation);
  const rawLines = song.lyrics_raw.split('\n');

  const bodyLines = rawLines.map((rawLine, index) => {
    const main = furiganaLines[index]
      ? renderFuriganaLineToHtml(furiganaLines[index], readingMode, song.reading_scheme)
      : renderPlainLineToHtml(rawLine);
    if (!includeTranslation) return main;
    const translation = translations[index]?.trim();
    if (!translation) return main;
    if (main === '<p class="empty">&nbsp;</p>') return main;
    return `${main}\n<p class="translation">${escapeHtml(translation)}</p>`;
  }).join('\n');

  const documentLanguage = song.reading_scheme === 'yue-jyutping' ? 'yue-Hant' : 'ja';

  return `<!DOCTYPE html>
<html lang="${documentLanguage}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(song.title)}</title>
<style>
  body { max-width: 600px; margin: 2rem auto; padding: 0 1rem; font-family: 'Noto Sans JP', sans-serif; line-height: 2.2; color: #1a1a1a; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .artist { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  p { margin: 0; }
  .empty { height: 1.2em; }
  .translation { margin-top: -0.55em; padding-bottom: 0.55em; font-size: 0.8em; line-height: 1.6; color: #666; }
  rt { font-size: 0.5em; color: #888; }
  ruby:has(rt[lang="yue-Latn"]) { ruby-overhang: none; white-space: nowrap; }
  rt[lang="yue-Latn"] { padding-inline: 0.08em; }
</style>
</head>
<body>
<h1>${escapeHtml(song.title)}</h1>
${song.artist ? `<p class="artist">${escapeHtml(song.artist)}</p>` : ''}
${bodyLines}
</body>
</html>`;
}

/** Raised when an export cannot be produced (e.g. LRC requested without a synced timeline). */
export class ExportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/** Render the export for the given song + options. */
export function buildExport(song: ExportSongData, options: ExportOptions): ExportResult {
  const { format, includeTranslation, reading = 'none' } = options;

  if (format === 'lrc') {
    let body = song.lyrics_synced ?? '';
    if (isEmptyAfterTrim(body)) {
      throw new ExportError(
        'lrc_no_synced_lyrics',
        'This song has no synced timeline; the LRC export would be an empty file.',
      );
    }
    // Standard LRC metadata tags (`[ti:]` title, `[ar:]` artist) let players
    // show the song info. LRCLIB synced lyrics usually carry them already, but
    // timelines built in the editor (`serializeTimelineDraft`) or from other
    // lyric sources often omit them — inject the tags when missing so the
    // exported file stays player-friendly without duplicating existing tags.
    const existingTags = extractLrcMetadata(body).tags;
    const missingTags: string[] = [];
    if (song.title && !existingTags.ti) missingTags.push(`[ti:${song.title}]`);
    if (song.artist && !existingTags.ar) missingTags.push(`[ar:${song.artist}]`);
    if (missingTags.length > 0) body = `${missingTags.join('\n')}\n${body}`;
    if (includeTranslation) {
      body = appendLrcTranslations(body, parseTranslations(song.lyrics_translation), song.lyrics_raw);
    }
    return {
      body,
      contentType: 'text/plain; charset=utf-8',
      extension: 'lrc',
    };
  }

  if (format === 'html') {
    return {
      body: buildHtmlExport(song, includeTranslation, reading),
      contentType: 'text/html; charset=utf-8',
      extension: 'html',
    };
  }

  return {
    body: buildTextExport(song, includeTranslation, reading),
    contentType: 'text/plain; charset=utf-8',
    extension: 'txt',
  };
}
