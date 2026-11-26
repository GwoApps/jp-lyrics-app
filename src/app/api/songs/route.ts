import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, sql, and } from '@/lib/db';
import { parseLrc, findLrcConflicts } from '@/lib/lrc';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTrack } from '@/lib/spotify';
import { parseJsonBody } from '@/lib/admin';
import { normalizeLyricsEol } from '@/lib/lyrics-content';
import { emptyLyricsReason, hasLyricsContent } from '@/lib/empty-lyrics';
import { buildLyricSearchText } from '@/lib/search-normalize';
import { songVisibilityWhere, SONGS_S_COLUMNS } from '@/lib/song-visibility';
import { withOfflineIdentity } from '@/lib/offline-identity';
import type { SQL } from 'drizzle-orm';
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

/**
 * Personalized song responses must never be persisted by shared caches or the
 * service worker (issue #298): the payload is scoped to the caller's session
 * (`?mine=1`/`?favorites=1`, private songs), so a cached copy would keep being
 * served to the next account on this browser after logout/switch — even while
 * offline, where the ACL in `getAuthUser`/`isSongVisibleToUser` never runs.
 * `private` forbids shared/CDN caching, `no-store` forbids any persistence;
 * `sw.js` honors the latter by skipping its cache write.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

// GET /api/songs - list songs with optional search and filter
export async function GET(request: NextRequest) {
  const db = getDB();
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const mine = request.nextUrl.searchParams.get('mine') === '1';
  const favoritesOnly = request.nextUrl.searchParams.get('favorites') === '1';
  const unclassifiedOnly = request.nextUrl.searchParams.get('unclassified') === '1';
  const user = await getAuthUser(request);
  const userEmail = user?.email || '';

  // Visibility is never hand-rolled per branch: every filter combination below
  // composes the filters it needs on top of this ONE predicate (ISSUE #346).
  // - logged-in non-admin -> `is_public = 1 OR created_by = <email>`
  // - anonymous          -> `is_public = 1` (a history row with an empty
  //                         created_by must NOT match)
  // - admin              -> 1 = 1 (no restriction)
  //
  // `visibleWhere` is TOTAL (never undefined) and is pushed into `filters`
  // unconditionally, so `and(...filters)` can never collapse to `undefined` —
  // which drizzle would render as an empty string, yielding `WHERE  ORDER BY`
  // and a SQLite syntax error for admins (2026-10-08 outage, admin-only).
  const visibleWhere = songVisibilityWhere(user, SONGS_S_COLUMNS);

  // Issue #462: expose the same edit permission GET /api/songs/[id] computes.
  // Anonymous viewers must never match `created_by = ''`, so their branch is
  // a literal 0 (legacy rows can have an empty owner).
  const canEditColumn = user
    ? sql`CASE WHEN ${user.isAdmin ? sql`1 = 1` : sql`1 = 0`} OR s.created_by = ${userEmail} THEN 1 ELSE 0 END AS can_edit`
    : sql`0 AS can_edit`;
  const selectColumns = sql`s.id, s.title, s.artist, s.cover_url, s.spotify_track_id, s.spotify_album, s.created_by_name, s.is_public, s.public_requested, s.created_at, s.updated_at, s.lyrics_needs_review, s.lyrics_source, s.lyrics_fetched_at, s.lyrics_raw, ${canEditColumn}`;

  /**
   * Normalize SQLite 0/1 and mark only songs with no visible lyric text. The
   * `lyrics_raw` column is read for the emptiness check and stripped again so
   * the list payload stays as small as before (issue #502).
   */
  function toSongListItems(rows: unknown[]): SongListItem[] {
    return rows.map((row) => {
      const { lyrics_furigana, lyrics_translation, lyrics_raw, ...song } =
        row as Omit<SongListItem, 'can_edit' | 'empty_lyrics_reason'> & {
          can_edit?: number;
          lyrics_furigana?: string | null;
          lyrics_translation?: string | null;
          lyrics_raw?: string | null;
          lyrics_source?: string | null;
          lyrics_fetched_at?: string | null;
        };
      return {
        ...song,
        can_edit: song.can_edit === 1,
        search_text: buildLyricSearchText({ lyrics_furigana, lyrics_translation }),
        ...(hasLyricsContent(lyrics_raw) ? {} : { empty_lyrics_reason: emptyLyricsReason(song) }),
      };
    });
  }

  if (favoritesOnly) {
    if (!user) {
      return NextResponse.json([], { headers: NO_STORE_HEADERS });
    }
    const pattern = q ? `%${q}%` : null;
    const filters: (SQL | undefined)[] = [
      q && pattern
        ? sql`(s.title LIKE ${pattern} OR s.artist LIKE ${pattern})`
        : undefined,
      mine ? sql`s.created_by = ${userEmail}` : undefined,
      unclassifiedOnly ? sql`f.in_unclassified = 1` : undefined,
      visibleWhere,
    ];
    const rawSql = sql`
      SELECT ${selectColumns}, s.lyrics_furigana, s.lyrics_translation
      FROM songs s
      INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ${userEmail}
      WHERE ${and(...filters)}
      ORDER BY s.created_at DESC
    `;
    const songs = toSongListItems(await db.all(rawSql));
    return withOfflineIdentity(
      NextResponse.json(songs, { headers: NO_STORE_HEADERS }),
      user?.id,
    );
  }

  // Non-favorites query
  {
    const pattern = q ? `%${q}%` : null;
    const filters: (SQL | undefined)[] = [
      q && pattern
        ? sql`(s.title LIKE ${pattern} OR s.artist LIKE ${pattern})`
        : undefined,
      // `?mine=1` without a session stays owner-scoped: an anonymous viewer has
      // no email, so `created_by = ''` legitimately lists the unowned rows.
      mine && user ? sql`s.created_by = ${userEmail}` : undefined,
      visibleWhere,
    ];
    const songs = await db.all(sql`
      SELECT ${selectColumns}, s.lyrics_furigana, s.lyrics_translation
      FROM songs s
      WHERE ${and(...filters)}
      ORDER BY s.created_at DESC
    `);
    return withOfflineIdentity(
      NextResponse.json(toSongListItems(songs), { headers: NO_STORE_HEADERS }),
      user?.id,
    );
  }
}

// POST /api/songs - create a new song
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const {
    title,
    artist,
    lyrics_raw,
    lyrics_synced,
    reading_scheme,
    spotify_track_id,
  } = body;

  if (!title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }
  if (reading_scheme !== undefined && reading_scheme !== 'ja-kana' && reading_scheme !== 'yue-jyutping') {
    return NextResponse.json({ error: 'invalid_reading_scheme' }, { status: 400 });
  }
  // Reject LRC whose timestamps are not strictly increasing so the playback
  // highlight engine can rely on monotonic ordering.
  if (lyrics_synced !== undefined && (typeof lyrics_synced !== 'string' || findLrcConflicts(lyrics_synced).length > 0)) {
    return NextResponse.json({ error: 'timestamps_not_ordered' }, { status: 400 });
  }

  const id = uuidv4();
  const requestedSpotifyTrackId = typeof spotify_track_id === 'string'
    ? spotify_track_id.trim()
    : '';
  const spotifyTrack = requestedSpotifyTrackId
    ? await getSpotifyTrack(user.email, requestedSpotifyTrackId)
    : null;

  // Every lyric write folds its line terminators to LF, so a hand-pasted CRLF
  // document cannot create another row that no reader can line-index (issue
  // #421). The fold happens here, before the plain text is derived from the LRC,
  // because that derivation also splits on `\n`.
  const syncedLyrics = normalizeLyricsEol(typeof lyrics_synced === 'string' ? lyrics_synced : '');
  let rawLyrics = normalizeLyricsEol(typeof lyrics_raw === 'string' ? lyrics_raw : '');
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
    readingScheme: reading_scheme ?? 'ja-kana',
    readingSchemeConfirmed: reading_scheme ? 1 : 0,
    lyricsSynced: syncedLyrics,
    coverUrl: spotifyTrack?.coverUrl ?? null,
    spotifyTrackId: spotifyTrack?.id ?? null,
    spotifyUri: spotifyTrack?.uri ?? null,
    spotifyAlbum: spotifyTrack?.album ?? null,
    spotifyDurationMs: spotifyTrack?.durationMs ?? null,
    spotifyCanonicalTitle: spotifyTrack?.title ?? null,
    spotifyCanonicalArtist: spotifyTrack?.artist ?? null,
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
