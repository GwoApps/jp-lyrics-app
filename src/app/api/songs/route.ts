import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, sql } from '@/lib/db';
import { parseLrc } from '@/lib/lrc';
import { getAuthUser } from '@/lib/auth';
import type { SongListItem } from '@/lib/types';

/** Look up Spotify display name from spotify_auth table */
async function getSpotifyDisplayName(email: string): Promise<string> {
  const db = getDB();
  const row = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(sql`user_email = ${email}`)
    .get();
  return row?.displayName || '';
}

// GET /api/songs - list songs with optional search and filter
export async function GET(request: NextRequest) {
  const db = getDB();
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const mine = request.nextUrl.searchParams.get('mine') === '1';
  const favoritesOnly = request.nextUrl.searchParams.get('favorites') === '1';
  const user = await getAuthUser(request);
  const isAdmin = user?.isAdmin === true;
  const userEmail = user?.email || '';

  if (favoritesOnly) {
    if (!user) {
      return NextResponse.json([]);
    }
    const pattern = q ? `%${q}%` : null;
    let rawSql;
    if (q && mine) {
      rawSql = isAdmin
        ? sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE (s.title LIKE ${pattern} OR s.artist LIKE ${pattern}) AND s.created_by = ${userEmail} ORDER BY s.updated_at DESC`
        : sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE (s.title LIKE ${pattern} OR s.artist LIKE ${pattern}) AND s.created_by = ${userEmail} AND (s.is_public = 1 OR s.created_by = ${userEmail}) ORDER BY s.updated_at DESC`;
    } else if (q) {
      rawSql = isAdmin
        ? sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE (s.title LIKE ${pattern} OR s.artist LIKE ${pattern}) ORDER BY s.updated_at DESC`
        : sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE (s.title LIKE ${pattern} OR s.artist LIKE ${pattern}) AND (s.is_public = 1 OR s.created_by = ${userEmail}) ORDER BY s.updated_at DESC`;
    } else if (mine) {
      rawSql = isAdmin
        ? sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE s.created_by = ${userEmail} ORDER BY s.updated_at DESC`
        : sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE s.created_by = ${userEmail} AND (s.is_public = 1 OR s.created_by = ${userEmail}) ORDER BY s.updated_at DESC`;
    } else {
      rawSql = isAdmin
        ? sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} ORDER BY s.updated_at DESC`
        : sql`SELECT s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.created_by, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at FROM songs s INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail} WHERE (s.is_public = 1 OR s.created_by = ${userEmail}) ORDER BY s.updated_at DESC`;
    }
    const songs = await db.all(rawSql) as unknown as SongListItem[];
    return NextResponse.json(songs);
  }

  // Non-favorites query
  if (q && mine && user) {
    const pattern = `%${q}%`;
    const songs = isAdmin
      ? await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE (title LIKE ${pattern} OR artist LIKE ${pattern}) AND created_by = ${userEmail} ORDER BY updated_at DESC`) as unknown as SongListItem[]
      : await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE (title LIKE ${pattern} OR artist LIKE ${pattern}) AND created_by = ${userEmail} AND (is_public = 1 OR created_by = ${userEmail}) ORDER BY updated_at DESC`) as unknown as SongListItem[];
    return NextResponse.json(songs);
  } else if (q) {
    const pattern = `%${q}%`;
    const songs = isAdmin
      ? await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE (title LIKE ${pattern} OR artist LIKE ${pattern}) ORDER BY updated_at DESC`) as unknown as SongListItem[]
      : await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE (title LIKE ${pattern} OR artist LIKE ${pattern}) AND is_public = 1 ORDER BY updated_at DESC`) as unknown as SongListItem[];
    return NextResponse.json(songs);
  } else if (mine && user) {
    const songs = isAdmin
      ? await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE created_by = ${userEmail} ORDER BY updated_at DESC`) as unknown as SongListItem[]
      : await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE created_by = ${userEmail} AND (is_public = 1 OR created_by = ${userEmail}) ORDER BY updated_at DESC`) as unknown as SongListItem[];
    return NextResponse.json(songs);
  } else {
    const songs = isAdmin
      ? await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs ORDER BY updated_at DESC`) as unknown as SongListItem[]
      : await db.all(sql`SELECT id, title, artist, cover_url, spotify_track_id, created_by, created_by_name, is_public, public_requested, created_at, updated_at FROM songs WHERE is_public = 1 ORDER BY updated_at DESC`) as unknown as SongListItem[];
    return NextResponse.json(songs);
  }
}

// POST /api/songs - create a new song
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced } = body;

  if (!title) {
    return NextResponse.json({ error: '曲名は必須です' }, { status: 400 });
  }

  const id = uuidv4();

  // If LRC synced lyrics provided, strip timestamps to get raw text
  let rawLyrics = lyrics_raw || '';
  const syncedLyrics = lyrics_synced || '';
  if (syncedLyrics && !rawLyrics) {
    const parsed = parseLrc(syncedLyrics);
    rawLyrics = parsed.map((l) => l.text).join('\n');
  }

  const createdBy = user?.email || '';
  const createdByName = user ? await getSpotifyDisplayName(user.email) : '';

  await db.insert(schema.songs).values({
    id,
    title,
    artist: artist || '',
    lyricsRaw: rawLyrics,
    lyricsFurigana: '[]',
    lyricsSynced: syncedLyrics,
    createdBy,
    createdByName,
  });

  // Re-fetch to get all fields with defaults populated; use raw SQL for snake_case response
  const song = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as Record<string, unknown>;
  // Strip internal email from response
  const rest = { ...song } as { created_by?: string; [k: string]: unknown };
  delete rest.created_by;
  return NextResponse.json(rest, { status: 201 });
}
