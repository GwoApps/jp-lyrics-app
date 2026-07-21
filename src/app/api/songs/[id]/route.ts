import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { Song } from '@/lib/types';
import { getAuthUser } from '@/lib/auth';
import { parseLrc } from '@/lib/lrc';

/** Strip internal email while exposing server-authoritative capabilities. */
function sanitizeSong(song: Song, canEdit: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { created_by, ...rest } = song;
  return { ...rest, permissions: { can_edit: canEdit } };
}

const songFields = {
  id: schema.songs.id,
  title: schema.songs.title,
  artist: schema.songs.artist,
  lyrics_raw: schema.songs.lyricsRaw,
  lyrics_furigana: schema.songs.lyricsFurigana,
  lyrics_synced: schema.songs.lyricsSynced,
  cover_url: schema.songs.coverUrl,
  spotify_track_id: schema.songs.spotifyTrackId,
  spotify_uri: schema.songs.spotifyUri,
  spotify_album: schema.songs.spotifyAlbum,
  spotify_duration_ms: schema.songs.spotifyDurationMs,
  spotify_canonical_title: schema.songs.spotifyCanonicalTitle,
  spotify_canonical_artist: schema.songs.spotifyCanonicalArtist,
  lyrics_source: schema.songs.lyricsSource,
  lyrics_confidence: schema.songs.lyricsConfidence,
  lyrics_fetched_at: schema.songs.lyricsFetchedAt,
  created_by: schema.songs.createdBy,
  created_by_name: schema.songs.createdByName,
  is_public: schema.songs.isPublic,
  public_requested: schema.songs.publicRequested,
  created_at: schema.songs.createdAt,
  updated_at: schema.songs.updatedAt,
};

function findSong(id: string) {
  return getDB().select(songFields).from(schema.songs).where(eq(schema.songs.id, id)).get() as Promise<Song | undefined>;
}

// GET /api/songs/[id] - get single song
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;
  const song = await findSong(id);
  if (!song || (song.is_public !== 1 && !user?.isAdmin && song.created_by !== user?.id)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  const canEdit = !!user && (user.isAdmin || song.created_by === user.id);
  return NextResponse.json(sanitizeSong(song, canEdit));
}

// PUT /api/songs/[id] - update song
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced, preserve_lyrics_metadata } = body;

  const existing = await findSong(id);
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const newSynced = lyrics_synced !== undefined ? lyrics_synced : existing.lyrics_synced;
  // Timed LRC is authoritative when it is submitted on its own, matching song creation.
  const newRaw = lyrics_synced !== undefined && lyrics_raw === undefined
    ? parseLrc(lyrics_synced).map((line) => line.text).join('\n')
    : (lyrics_raw !== undefined ? lyrics_raw : existing.lyrics_raw);

  let lyricsFurigana = existing.lyrics_furigana;
  // Clear furigana whenever the rendered plain lyrics change.
  if (newRaw !== existing.lyrics_raw) {
    lyricsFurigana = '[]';
  }

  const lyricsChanged = lyrics_raw !== undefined || lyrics_synced !== undefined;
  await db.update(schema.songs).set({
    title: title !== undefined ? title : existing.title,
    artist: artist !== undefined ? artist : existing.artist,
    lyricsRaw: newRaw,
    lyricsFurigana,
    lyricsSynced: newSynced,
    ...(lyricsChanged && preserve_lyrics_metadata !== true ? {
      lyricsSource: 'manual',
      lyricsConfidence: 100,
      lyricsFetchedAt: null,
    } : {}),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id));

  const updated = await findSong(id);
  if (!updated) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(updated, true));
}

// DELETE /api/songs/[id] - delete song
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const existing = await findSong(id);
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await db.delete(schema.songs).where(eq(schema.songs.id, id));
  return NextResponse.json({ success: true });
}
