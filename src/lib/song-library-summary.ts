import { isEmptyAfterTrim, parseFuriganaLines, parseTranslations } from './lyrics-export.ts';
import { isLrcMetadataLine, LRC_LEADING_TIMESTAMPS_REGEX, LRC_TIMESTAMP_REGEX, parseLrc, parseLrcTimestamp } from './lrc.ts';
import type { SongListItem } from './types.ts';

type SummaryColumns = 'spotify_duration_ms' | 'has_lyrics' | 'has_synced_timeline' | 'has_furigana' | 'has_translation' | 'lyrics_translation_lang';
export type SongLibrarySummary = Required<Pick<SongListItem, SummaryColumns>>;

interface StoredSummaryContent {
  spotify_duration_ms: unknown;
  lyrics_raw: unknown;
  lyrics_synced: unknown;
  lyrics_furigana: unknown;
  lyrics_translation: unknown;
  lyrics_translation_lang: unknown;
}

/** Distinguish malformed storage from the parsers' intentionally forgiving empty fallback. */
function storedArray(value: unknown): unknown[] | null {
  if (typeof value !== 'string') return null;
  if (isEmptyAfterTrim(value)) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function hasFurigana(value: unknown): boolean | null {
  const lines = storedArray(value);
  if (!lines) return null;
  for (const line of lines) {
    if (!line || typeof line !== 'object' || !('segments' in line) || !Array.isArray(line.segments)) return null;
    for (const segment of line.segments) {
      if (!segment || typeof segment !== 'object' || typeof segment.text !== 'string' || typeof segment.reading !== 'string') return null;
    }
  }
  return parseFuriganaLines(value as string).some((line) => line.segments.some((segment) =>
    !isEmptyAfterTrim(segment.reading) && segment.text !== segment.reading));
}

function hasTranslation(value: unknown): boolean | null {
  const lines = storedArray(value);
  if (!lines || lines.some((line) => typeof line !== 'string')) return null;
  return parseTranslations(value as string).some((line) => !isEmptyAfterTrim(line));
}

function hasTimeline(value: unknown): boolean | null {
  if (typeof value !== 'string') return null;
  // Untimed rows are valid partial timeline drafts, not synced lyrics. Invalid
  // bracket/timestamp syntax is unknown, rather than a fabricated missing flag.
  for (const line of value.split('\n').map((line) => line.trim())) {
    if (!line || isLrcMetadataLine(line) || !line.startsWith('[')) continue;
    const prefix = line.match(LRC_LEADING_TIMESTAMPS_REGEX)?.[0];
    if (!prefix) return null;
    for (const timestamp of prefix.matchAll(LRC_TIMESTAMP_REGEX)) {
      if (parseLrcTimestamp(timestamp[0].slice(1, -1)) === null) return null;
    }
  }
  return parseLrc(value.split('\n').map((line) => line.trim()).join('\n')).length > 0;
}

function translationLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || isEmptyAfterTrim(value)) return null;
  try { return Intl.getCanonicalLocales(value.trim())[0] ?? null; }
  catch { return null; }
}

/** Explicit tri-state metadata only: no lyric bodies or invented duration/language defaults. */
export function summarizeSongLibraryContent(content: StoredSummaryContent): SongLibrarySummary {
  const translation = hasTranslation(content.lyrics_translation);
  const duration = content.spotify_duration_ms;
  return {
    spotify_duration_ms: typeof duration === 'number' && Number.isFinite(duration) && Number.isInteger(duration) && duration > 0 ? duration : null,
    has_lyrics: typeof content.lyrics_raw === 'string' ? !isEmptyAfterTrim(content.lyrics_raw) : null,
    has_synced_timeline: hasTimeline(content.lyrics_synced),
    has_furigana: hasFurigana(content.lyrics_furigana),
    has_translation: translation,
    lyrics_translation_lang: translation === true ? translationLanguage(content.lyrics_translation_lang) : null,
  };
}
