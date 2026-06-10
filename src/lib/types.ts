export interface Song {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  lyrics_synced: string;
  created_by: string;
  created_by_name: string;
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

export interface SongListItem {
  id: string;
  title: string;
  artist: string;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
}
