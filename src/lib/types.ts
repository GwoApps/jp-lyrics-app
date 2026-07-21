export interface Song {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  lyrics_synced: string;
  cover_url?: string | null;
  spotify_track_id?: string | null;
  spotify_uri?: string | null;
  spotify_album?: string | null;
  spotify_duration_ms?: number | null;
  spotify_canonical_title?: string | null;
  spotify_canonical_artist?: string | null;
  lyrics_source: string;
  lyrics_confidence: number;
  lyrics_fetched_at?: string | null;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
}

export interface FuriganaSegment {
  text: string;
  reading: string;
}

export interface FuriganaLine {
  segments: FuriganaSegment[];
}

export type ReadingMode = 'original' | 'furigana' | 'romaji';

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
  created_at: string;
  updated_at: string;
}
