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
   * timeline and ignores this option.
   */
  reading?: ExportReadingMode;
}

export interface ExportResult {
  body: string;
  contentType: string;
  extension: string;
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

/** Parse the stored translation JSON array (aligned to `lyrics_raw` lines). */
export function parseTranslations(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
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

/** Render the export for the given song + options. */
export function buildExport(song: ExportSongData, options: ExportOptions): ExportResult {
  const { format, includeTranslation, reading = 'none' } = options;

  if (format === 'lrc') {
    return {
      body: song.lyrics_synced || '',
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
