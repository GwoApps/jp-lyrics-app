/**
 * Full-library JSON backup (ISSUE #471).
 *
 * The app's only export path used to be single-song txt/lrc/html, leaving the
 * hand-corrected furigana/translations/timelines of the whole library locked
 * inside one SQLite/D1 volume. This module turns raw song rows into a single
 * versioned, self-contained JSON document that can be saved anywhere and fed
 * back to a future importer.
 *
 * Pure functions over row objects: no DB handle, no server/runtime dependency,
 * so the shape can be unit-tested in isolation.
 */

/** Bump when the JSON shape changes incompatibly. */
export const LIBRARY_EXPORT_VERSION = 1;

/** Version tag placed in every exported file for forward/backward compatibility. */
export function libraryExportGeneratedAt(now = new Date()): string {
  return now.toISOString();
}

/** Free of per-user ownership data: no created_by / created_by_name / private flags. */
export interface LibraryExportSong {
  id: string;
  title: string;
  artist: string;
  lyrics: string;
  furigana: Array<{ segments: Array<{ text: string; reading?: string; [key: string]: unknown }> }>;
  reading_scheme: string;
  synced_lyrics: string;
  translation: string[];
  translation_lang: string | null;
  glossary: unknown[];
  metadata: {
    lyrics_source: string;
    lyrics_confidence: number;
    lyrics_fetched_at: string | null;
    spotify_track_id: string | null;
    spotify_album: string | null;
    spotify_duration_ms: number | null;
    created_at: string;
    updated_at: string;
  };
}

export interface LibraryExportPayload {
  format: 'jp-lyrics-library';
  version: number;
  exported_at: string;
  song_count: number;
  songs: LibraryExportSong[];
}

/** Raw song row (snake_case DB columns) accepted by the exporter. */
export type LibraryExportRow = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse a stored JSON array of strings, preserving the index alignment to the
 * source lyrics. Non-string entries become '' at their original index.
 */
function parseTranslationArray(value: unknown): string[] {
  return parseJsonArray(value).map((entry) => typeof entry === 'string' ? entry : '');
}

/**
 * Furigana rows are stored as a JSON array of `{ segments: [...] }` aligned to
 * the lyrics lines. Each segment keeps its original fields so a future
 * importer can reconstruct ruby annotations exactly.
 */
function parseFuriganaArray(value: unknown): LibraryExportSong['furigana'] {
  return parseJsonArray(value).filter(
    (line): line is LibraryExportSong['furigana'][number] =>
      typeof line === 'object' && line !== null && Array.isArray((line as { segments?: unknown }).segments),
  ).map((line) => ({
    segments: (line as { segments: unknown[] }).segments.map((seg) =>
      typeof seg === 'object' && seg !== null ? { ...(seg as Record<string, unknown>) } : { text: '' },
    ) as LibraryExportSong['furigana'][number]['segments'],
  }));
}

/** Convert one raw DB row into the stable, public export shape. */
export function toLibraryExportSong(row: LibraryExportRow): LibraryExportSong {
  return {
    id: asString(row.id),
    title: asString(row.title),
    artist: asString(row.artist),
    lyrics: asString(row.lyrics_raw),
    furigana: parseFuriganaArray(row.lyrics_furigana),
    reading_scheme: asString(row.reading_scheme),
    synced_lyrics: asString(row.lyrics_synced),
    translation: parseTranslationArray(row.lyrics_translation),
    translation_lang: asNullableString(row.lyrics_translation_lang),
    glossary: parseJsonArray(row.lyrics_glossary),
    metadata: {
      lyrics_source: asString(row.lyrics_source),
      lyrics_confidence: asNumber(row.lyrics_confidence, 100),
      lyrics_fetched_at: asNullableString(row.lyrics_fetched_at),
      spotify_track_id: asNullableString(row.spotify_track_id),
      spotify_album: asNullableString(row.spotify_album),
      spotify_duration_ms: asNullableNumber(row.spotify_duration_ms),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
    },
  };
}

/** Assemble the complete backup document. Rows are exported in the given order. */
export function buildLibraryExport(
  rows: readonly LibraryExportRow[],
  now = new Date(),
): LibraryExportPayload {
  return {
    format: 'jp-lyrics-library',
    version: LIBRARY_EXPORT_VERSION,
    exported_at: libraryExportGeneratedAt(now),
    song_count: rows.length,
    songs: rows.map(toLibraryExportSong),
  };
}

/** Filename for the backup download, e.g. `lyrics-backup-2026-11-27.json`. */
export function libraryExportFilename(now = new Date()): string {
  return `lyrics-backup-${now.toISOString().slice(0, 10)}.json`;
}
