import { v4 as uuidv4 } from 'uuid';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDB, schema } from '@/lib/db';
import { fetchLyrics } from '@/lib/lyrics-fetcher';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import type { AuthUser } from '@/lib/auth';

/**
 * Shared playlist-import machinery used by `POST /api/songs/import-playlist`
 * (create a job) and `PUT /api/songs/import-playlist` (process one chunk).
 *
 * The whole import is deliberately split into many short Worker requests so a
 * large playlist never exhausts the Cloudflare execution / subrequest limits in
 * a single invocation. Track outcomes are persisted per Spotify track id, which
 * makes retries idempotent and lets the client resume after a timeout, cancel,
 * or a page refresh.
 */

/** How many tracks one Worker request may process before returning. */
export const PLAYLIST_CHUNK_SIZE = 8;
/** Upper bound on tracks per job — protects the playlist fetch itself. */
export const PLAYLIST_MAX_TRACKS = 200;
/** Hard timeout for a single external lyrics fetch (LRCLIB + PetitLyrics + …). */
export const LYRICS_FETCH_TIMEOUT_MS = 20_000;

export type TrackStatus = 'imported' | 'skipped' | 'failed';

export interface PlaylistTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

export interface PlaylistTrackResult {
  spotifyId?: string;
  title: string;
  artist: string;
  status: TrackStatus;
  source?: string;
  synced?: boolean;
  needsReview?: boolean;
}

/** Persisted outcome for a track (used to replay already-done tracks on resume). */
export interface PersistedTrackResult {
  status: TrackStatus;
  needsReview: boolean;
}

/** All persisted outcomes for a job, in the order they were processed. */
export async function listTrackResults(
  jobId: string,
): Promise<PlaylistTrackResult[]> {
  const db = getDB();
  const rows = await db.select({
    spotifyTrackId: schema.playlistImportTrackResults.spotifyTrackId,
    title: schema.playlistImportTrackResults.title,
    artist: schema.playlistImportTrackResults.artist,
    status: schema.playlistImportTrackResults.status,
    needsReview: schema.playlistImportTrackResults.needsReview,
  })
    .from(schema.playlistImportTrackResults)
    .where(eq(schema.playlistImportTrackResults.jobId, jobId))
    .orderBy(schema.playlistImportTrackResults.createdAt)
    .all();
  return rows.map((row: { spotifyTrackId: string; title: string; artist: string; status: string; needsReview: number }) => ({
    spotifyId: row.spotifyTrackId,
    title: row.title,
    artist: row.artist,
    status: row.status as TrackStatus,
    ...(row.needsReview ? { needsReview: true } : {}),
  }));
}

export interface PlaylistJobSummary {
  id: string;
  playlistId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
}

function extractPlaylistId(input: string): string | null {
  const urlMatch = input.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;
  return null;
}

export { extractPlaylistId };

/** Fetch all tracks of a Spotify playlist (paged, capped at PLAYLIST_MAX_TRACKS). */
export async function fetchPlaylistTracks(
  playlistId: string,
  accessToken: string,
): Promise<PlaylistTrack[]> {
  const tracks: PlaylistTrack[] = [];
  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,uri,name,duration_ms,artists(name),album(name,images(url,width)))),next`;

  while (nextUrl && tracks.length < PLAYLIST_MAX_TRACKS) {
    const spotifyRes = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!spotifyRes.ok) {
      const error = new Error('playlist_fetch_failed') as Error & { status?: number };
      error.status = spotifyRes.status;
      throw error;
    }
    const data = (await spotifyRes.json()) as {
      items: { track: SpotifyApiTrack | null }[];
      next: string | null;
    };
    for (const item of data.items || []) {
      if (tracks.length >= PLAYLIST_MAX_TRACKS) break;
      const track = item.track;
      if (track?.id && track.name) {
        const cover = track.album?.images?.length
          ? track.album.images.reduce((best, image) =>
              (image.width || 0) > (best.width || 0) ? image : best,
              track.album.images[0],
            ).url || null
          : null;
        tracks.push({
          id: track.id,
          uri: track.uri || `spotify:track:${track.id}`,
          title: track.name,
          artist: track.artists?.map((a) => a.name).join(', ') || '',
          album: track.album?.name || '',
          durationMs: track.duration_ms || 0,
          coverUrl: cover,
        });
      }
    }
    nextUrl = data.next || null;
  }

  return tracks;
}

interface SpotifyApiTrack {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: {
    name?: string;
    images?: { width?: number; url: string }[];
  };
}

/** Load a job row, verifying ownership. Returns null when missing / not owned. */
export async function getOwnedJob(
  jobId: string,
  userEmail: string,
): Promise<PlaylistJobSummary | null> {
  const db = getDB();
  const row = await db.select({
    id: schema.playlistImportJobs.id,
    playlistId: schema.playlistImportJobs.playlistId,
    status: schema.playlistImportJobs.status,
    total: schema.playlistImportJobs.total,
    processed: schema.playlistImportJobs.processed,
    imported: schema.playlistImportJobs.imported,
    skipped: schema.playlistImportJobs.skipped,
    failed: schema.playlistImportJobs.failed,
  }).from(schema.playlistImportJobs)
    .where(and(eq(schema.playlistImportJobs.id, jobId), eq(schema.playlistImportJobs.userEmail, userEmail)))
    .get();
  return row ?? null;
}

/** Persist the outcome of a single track (idempotent by job id + Spotify track id). */
export async function saveTrackResult(
  jobId: string,
  track: PlaylistTrack,
  result: Omit<PlaylistTrackResult, 'title' | 'artist'>,
): Promise<void> {
  const db = getDB();
  const inc = {
    imported: result.status === 'imported' ? 1 : 0,
    skipped: result.status === 'skipped' ? 1 : 0,
    failed: result.status === 'failed' ? 1 : 0,
  };
  await db.run(sql`
    UPDATE playlist_import_jobs
    SET processed = processed + 1,
        imported = imported + ${inc.imported},
        skipped = skipped + ${inc.skipped},
        failed = failed + ${inc.failed},
        status = 'running',
        updated_at = datetime('now', 'localtime')
    WHERE id = ${jobId}
  `);
  await db.insert(schema.playlistImportTrackResults).values({
    jobId,
    spotifyTrackId: track.id,
    title: track.title,
    artist: track.artist,
    status: result.status,
    needsReview: result.needsReview ? 1 : 0,
  }).onConflictDoNothing();
}

/** Create a fresh import job and return its summary. */
export async function createJob(
  user: AuthUser,
  playlistId: string,
  tracks: PlaylistTrack[],
): Promise<PlaylistJobSummary> {
  const db = getDB();
  const id = uuidv4();
  await db.insert(schema.playlistImportJobs).values({
    id,
    userEmail: user.email,
    playlistId,
    status: 'pending',
    total: tracks.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  });
  return { id, playlistId, status: 'pending', total: tracks.length, processed: 0, imported: 0, skipped: 0, failed: 0 };
}

/** Mark the job completed (all tracks processed) or cancelled / failed. */
export async function finishJob(
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  const db = getDB();
  await db.run(sql`
    UPDATE playlist_import_jobs
    SET status = ${status}, updated_at = datetime('now', 'localtime')
    WHERE id = ${jobId}
  `);
}

/** Ensure the access token for a user, throwing a typed error when unavailable. */
export async function requireSpotifyToken(userEmail: string): Promise<string> {
  const accessToken = await getSpotifyTokenForUser(userEmail);
  if (!accessToken) {
    throw new Error('spotify_not_connected');
  }
  return accessToken;
}

/**
 * Look up the saved outcome for every track of the job. Tracks that already
 * have a result (from a previous timed-out / cancelled request) are replayed
 * from this map on resume — without re-fetching lyrics or double-counting.
 */
export async function existingResultsForChunk(
  jobId: string,
  tracks: PlaylistTrack[],
): Promise<Map<string, PersistedTrackResult>> {
  const results = new Map<string, PersistedTrackResult>();
  if (tracks.length === 0) return results;
  const db = getDB();
  const rows = await db.select({
    spotifyTrackId: schema.playlistImportTrackResults.spotifyTrackId,
    status: schema.playlistImportTrackResults.status,
    needsReview: schema.playlistImportTrackResults.needsReview,
  })
    .from(schema.playlistImportTrackResults)
    .where(eq(schema.playlistImportTrackResults.jobId, jobId))
    .all();
  for (const row of rows) {
    results.set(row.spotifyTrackId, {
      status: row.status as TrackStatus,
      needsReview: !!row.needsReview,
    });
  }
  return results;
}

/**
 * Process a single track through the same quality gate as the rest of the app:
 * duplicate check → fetch lyrics (with a hard per-track timeout) → persist.
 * Returns the outcome without touching the job counters here — the caller
 * aggregates and calls `saveTrackResult` once per track so a mid-chunk timeout
 * never leaves the job counters out of sync with the track table.
 */
export async function processTrack(
  user: AuthUser,
  createdByName: string,
  track: PlaylistTrack,
): Promise<Omit<PlaylistTrackResult, 'title' | 'artist'>> {
  const db = getDB();

  // Skip duplicates — same rule as before: same Spotify track id, or same
  // title + artist, limited to songs the user can see.
  const duplicate = or(
    eq(schema.songs.spotifyTrackId, track.id),
    and(eq(schema.songs.title, track.title), eq(schema.songs.artist, track.artist)),
  );
  const visibleToUser = user.isAdmin
    ? undefined
    : or(eq(schema.songs.createdBy, user.email), eq(schema.songs.isPublic, 1));
  const existing = await db.select({ id: schema.songs.id })
    .from(schema.songs)
    .where(visibleToUser ? and(duplicate, visibleToUser) : duplicate)
    .get();

  if (existing) {
    return { status: 'skipped' };
  }

  // Fetch lyrics from all sources — failure is non-fatal, but must not block
  // the whole batch: hard timeout per track, then fall through to the next one.
  let lyrics: { synced: string; plain: string } | null = null;
  let source = '';
  let confidence = 0;
  let needsReview = false;
  try {
    const r = await withTimeout(
      fetchLyrics(track.title, track.artist, {
        spotify: {
          durationMs: track.durationMs,
          album: track.album || undefined,
        },
      }),
      LYRICS_FETCH_TIMEOUT_MS,
      'lyrics fetch timeout',
    );
    lyrics = r.result;
    source = r.source;
    confidence = r.confidence;
    if (lyrics) {
      const verdict = classifyLyricsHit({
        source,
        confidence,
        synced: !!lyrics.synced.trim(),
        hasExistingTimeline: false,
        durationMismatch: r.durationMismatch,
      });
      if (verdict === 'rejected') {
        // Below the hard quality floor — treat as a miss rather than saving a
        // likely-wrong candidate as if it were a success.
        lyrics = null;
        source = '';
        confidence = 0;
      } else if (verdict === 'needs_review') {
        needsReview = true;
      }
    }
  } catch (error) {
    // Individual track failure — continue to next
    console.warn(`[import-playlist] lyrics fetch failed for "${track.title}" — ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    // Only persist a song when lyrics were actually found — an empty shell with
    // "no lyrics" pollutes the library (single-song import returns 404 instead).
    if (!lyrics) {
      return { status: 'failed' };
    }
    const id = uuidv4();
    await db.insert(schema.songs).values({
      id,
      title: track.title,
      artist: track.artist,
      lyricsRaw: lyrics.plain,
      lyricsFurigana: '[]',
      lyricsSynced: lyrics.synced,
      coverUrl: track.coverUrl,
      spotifyTrackId: track.id,
      spotifyUri: track.uri,
      spotifyAlbum: track.album,
      spotifyDurationMs: track.durationMs,
      spotifyCanonicalTitle: track.title,
      spotifyCanonicalArtist: track.artist,
      lyricsSource: source,
      lyricsConfidence: confidence,
      lyricsNeedsReview: needsReview ? 1 : 0,
      lyricsFetchedAt: new Date().toISOString(),
      createdBy: user.email,
      createdByName,
    });

    return {
      status: 'imported',
      source,
      synced: !!lyrics.synced,
      ...(needsReview ? { needsReview } : {}),
    };
  } catch (error) {
    console.warn(`[import-playlist] failed to save "${track.title}" — ${error instanceof Error ? error.message : String(error)}`);
    return { status: 'failed' };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
