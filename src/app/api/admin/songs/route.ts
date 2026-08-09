import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { parseFuriganaLines, parseTranslations } from '@/lib/lyrics-export';
import { getLrcTextLines } from '@/lib/lrc';

/**
 * Compute lightweight quality-summary fields for a song without shipping the
 * full lyrics body into the admin list. The full content is fetched on demand
 * by the preview dialog via GET /api/songs/[id].
 */
function withLyricsSummary(
  row: Record<string, unknown>,
  lyricsRaw: string,
  lyricsSynced: string,
  lyricsFurigana: string,
  lyricsTranslation: string,
): Record<string, unknown> {
  const lyricLines = lyricsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const hasFurigana = parseFuriganaLines(lyricsFurigana)
    .some((line) => line.segments.some((seg) => seg.reading && seg.text !== seg.reading));
  const hasTranslation = parseTranslations(lyricsTranslation).some((line) => line.trim().length > 0);

  // Destructure to strip the full lyrics columns from the list payload while
  // keeping them available for summary computation.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lyrics_raw, lyrics_synced, lyrics_furigana, lyrics_translation, ...rest } = row;
  return {
    ...rest,
    lyric_line_count: lyricLines.length,
    has_synced_timeline: getLrcTextLines(lyricsSynced).length > 0,
    has_furigana: hasFurigana,
    has_translation: hasTranslation,
    lyrics_preview: lyricLines.slice(0, 6).join('\n'),
  };
}

// GET /api/admin/songs — list all songs with creator info and lightweight
// quality summaries (admin only). Full lyrics are intentionally not included;
// they are fetched on demand by the preview dialog.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const songs = await db.all(
    sql`SELECT s.id, s.title, s.artist, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at,
               s.lyrics_raw, s.lyrics_synced, s.lyrics_furigana, s.lyrics_translation, s.lyrics_needs_review, s.lyrics_confidence, s.lyrics_source
        FROM songs s ORDER BY s.updated_at DESC`
  );
  return NextResponse.json(
    songs.map((song: Record<string, unknown>) =>
      withLyricsSummary(
        song,
        String(song.lyrics_raw ?? ''),
        String(song.lyrics_synced ?? ''),
        String(song.lyrics_furigana ?? ''),
        String(song.lyrics_translation ?? ''),
      )
    )
  );
}
