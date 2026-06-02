export interface Song {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;      // original with kanji
  lyrics_furigana: string;  // JSON: Array<FuriganaLine>
  created_at: string;
  updated_at: string;
}

export interface FuriganaSegment {
  text: string;      // surface form (kanji/kana)
  reading: string;   // hiragana reading (empty if same as text)
}

export interface FuriganaLine {
  segments: FuriganaSegment[];
}

export interface SongListItem {
  id: string;
  title: string;
  artist: string;
  created_at: string;
  updated_at: string;
}
