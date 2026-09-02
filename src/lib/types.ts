export interface Song {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  reading_scheme: ReadingScheme;
  reading_scheme_confirmed: number;
  lyrics_synced: string;
  lyrics_translation: string;
  lyrics_translation_lang?: string | null;
  lyrics_translation_reasoning?: string | null;
  lyrics_glossary?: string | null;
  cover_url?: string | null;
  cover_palette?: CoverPaletteJson | null;
  spotify_track_id?: string | null;
  spotify_uri?: string | null;
  spotify_album?: string | null;
  spotify_duration_ms?: number | null;
  spotify_canonical_title?: string | null;
  spotify_canonical_artist?: string | null;
  lyrics_source: string;
  lyrics_confidence: number;
  lyrics_needs_review: number;
  lyrics_fetched_at?: string | null;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
}

/** Song detail as returned by the API: DB model minus internal `created_by`, plus per-user permissions. */
export type SongData = Omit<Song, 'created_by'> & { permissions?: { can_edit: boolean } };

export interface FuriganaSegment {
  text: string;
  reading: string;
}

export interface FuriganaLine {
  segments: FuriganaSegment[];
}

export type ReadingMode = 'original' | 'furigana';
export type ReadingScheme = 'ja-kana' | 'yue-jyutping';

/** Serialized cover palette as stored in the DB / API (snake_case field). */
export interface CoverColorJson {
  r: number;
  g: number;
  b: number;
}
export interface CoverPaletteJson {
  primary: CoverColorJson;
  secondary: CoverColorJson;
  tertiary: CoverColorJson;
}

export interface SongListItem {
  id: string;
  title: string;
  artist: string;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  cover_url?: string | null;
  spotify_track_id?: string | null;
  spotify_album?: string | null;
  created_at: string;
  updated_at: string;
}

/** Song list item as used by the home page (same shape as SongListItem). */
export type SongItem = SongListItem;
