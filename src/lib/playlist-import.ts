import { v4 as uuidv4 } from 'uuid';
import { and, asc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { getDB, schema } from '@/lib/db';
import { fetchLyricsWithChain } from '@/lib/lyrics-provider';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import type { AuthUser } from '@/lib/auth';

/**
 * Shared playlist-import machinery used by `POST /api/songs/import-playlist`
 * (create a job) and `PUT /api/songs/import-playlist` (process one chunk).
 *
 * The whole import is deliberately split into many short Worker requests so a
 * large playlist never exhausts the Cloudflare execution / subrequest limits in
 * a single invocation. Track outcomes are persisted per *playlist slot*
 * (`trackIndex` — the position of the track inside the playlist), which makes
 * retries idempotent and lets the client resume after a timeout, cancel, or a
 * page refresh.
 *
 * Slot identity matters (ISSUE #347): a playlist may contain the same song more
 * than once, so keying the result rows on the Spotify track id made the second
 * occurrence look like a retry of the first — the INSERT hit ON CONFLICT, the
 * counters were not bumped, and `processed` could never reach `total`.
 */

import {
  PLAYLIST_MAX_TRACKS,
  LYRICS_FETCH_TIMEOUT_MS,
} from '@/lib/playlist-import-constants';

export {
  PLAYLIST_CHUNK_SIZE,
  PLAYLIST_CHUNK_HOP,
  PLAYLIST_IMPORT_RESUME_UNSUPPORTED,
  PLAYLIST_MAX_TRACKS,
  LYRICS_FETCH_TIMEOUT_MS,
} from '@/lib/playlist-import-constants';
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
  /** True when every source failed because the lrclib source was rate-limited (HTTP 429). */
  rateLimited?: boolean;
}

/** Persisted outcome for a track (used to replay already-done tracks on resume). */
export interface PersistedTrackResult {
  status: TrackStatus;
  needsReview: boolean;
}

/**
 * Outcome of a resume read: the persisted rows in slot order plus the offset of
 * the first slot that is *not* persisted.
 *
 * The offset matters because slot 0 is the client's cursor origin: a job whose
 * earliest row cannot be attributed to a slot (rows written before migration
 * 0022) must not be resumed, and `resumeOffset` is negative in exactly that case.
 */
export interface PersistedTrackResults {
  results: PersistedTrackResult[];
  /** Slot index of the first not-yet-persisted row, or a negative value when the ordering is unknown. */
  resumeOffset: number;
}

/** All persisted outcomes for a job, in playlist order (one row per slot). */
export async function listTrackResults(
  jobId: string,
): Promise<PlaylistTrackResult[]> {
  const db = getDB();
  const rows = await db.select({
    spotifyTrackId: schema.playlistImportTrackResults.spotifyTrackId,
    trackIndex: schema.playlistImportTrackResults.trackIndex,
    title: schema.playlistImportTrackResults.title,
    artist: schema.playlistImportTrackResults.artist,
    status: schema.playlistImportTrackResults.status,
    needsReview: schema.playlistImportTrackResults.needsReview,
  })
    .from(schema.playlistImportTrackResults)
    .where(eq(schema.playlistImportTrackResults.jobId, jobId))
    .orderBy(asc(schema.playlistImportTrackResults.trackIndex), asc(schema.playlistImportTrackResults.createdAt))
    .all();
  return rows.map((row: { spotifyTrackId: string; trackIndex: number; title: string; artist: string; status: string; needsReview: number }) => ({
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

/** How a playlist was resolved — what the cap actually dropped (ISSUE #324). */
export interface PlaylistFetch {
  /** The tracks to import (never more than `PLAYLIST_MAX_TRACKS`). */
  tracks: PlaylistTrack[];
  /**
   * Total number of items the playlist reports (`total` from the Spotify API),
   * i.e. before any cap or item filtering. `null` when Spotify did not report
   * one — in that case `mayHaveMore` and `dropped` stay `null` too rather than
   * guessing, so callers can render a probability instead of a fake number.
   */
  playlistTotal: number | null;
  /**
   * True only when the playlist really holds more than we fetched — either the
   * cap was hit with a `next` page still pending, or the reported total exceeds
   * what we kept. A playlist of exactly `PLAYLIST_MAX_TRACKS` is NOT truncated.
   */
  truncated: boolean;
  /** Whether the fetch stopped before the reported total (null when unknown). */
  mayHaveMore: boolean | null;
  /** Tracks we could not fetch: `playlistTotal - tracks.length` (null when unknown). */
  dropped: number | null;
  /** Diagnostic only: how many raw playlist items were read across pages. */
  rawItems: number;
}

/** Fetch all tracks of a Spotify playlist (paged, capped at PLAYLIST_MAX_TRACKS). */
export async function fetchPlaylistTracks(
  playlistId: string,
  accessToken: string,
): Promise<PlaylistTrack[]> {
  const { tracks } = await fetchPlaylistTrackPage(playlistId, accessToken);
  return tracks;
}

/**
 * Fetch a playlist together with the real numbers behind the cap (ISSUE #324).
 *
 * Asking Spotify for `total` (and keeping the `next` page marker) is what makes
 * the cap *decidable*: the previous `tracks.length >= PLAYLIST_MAX_TRACKS` guess
 * also fired for a playlist of exactly 200 tracks (nothing dropped) and threw
 * away the one signal that actually means "there is another page". Here the
 * truncated / dropped numbers are derived from what Spotify reports, never
 * inferred from the track count alone.
 */
export async function fetchPlaylistTrackPage(
  playlistId: string,
  accessToken: string,
): Promise<PlaylistFetch> {
  const tracks: PlaylistTrack[] = [];
  let rawItems = 0;
  let reportedTotal: number | null = null;
  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=total,items(track(id,uri,name,duration_ms,artists(name),album(name,images(url,width)))),next`;

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
      total?: number | null;
      next: string | null;
    };
    // `total` counts every playlist item, including ones we filter out below
    // (removed tracks, local files, episodes) — that is exactly why it has to
    // come from the API instead of being derived from `tracks.length`.
    if (reportedTotal == null && typeof data.total === 'number' && Number.isFinite(data.total)) {
      reportedTotal = Math.max(0, Math.floor(data.total));
    }
    const pageItems = data.items || [];
    rawItems += pageItems.length;
    for (const item of pageItems) {
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

  const nextPagePending = nextUrl != null;
  const reportedGap = reportedTotal != null && reportedTotal > tracks.length;
  const mayHaveMore = reportedTotal == null
    ? (nextPagePending ? true : null)
    : (nextPagePending || reportedGap);
  const dropped = reportedTotal == null ? null : Math.max(0, reportedTotal - tracks.length);

  return {
    tracks,
    playlistTotal: reportedTotal,
    truncated: mayHaveMore === true,
    mayHaveMore,
    dropped,
    rawItems,
  };
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

/**
 * Persist the outcome of one playlist slot (idempotent by job id + track index).
 *
 * `trackIndex` is the position of the track in the playlist, i.e. the slot
 * identity requested by ISSUE #347. Two identical songs in a playlist are two
 * different slots and therefore two different rows, so `processed` always
 * reaches `total`; a retry of the *same* slot is still a no-op.
 *
 * Deliberately NOT an upsert: the first writer wins, exactly like the previous
 * ON CONFLICT DO NOTHING behaviour that #212 relies on (a replayed chunk must
 * not re-classify an already-counted slot, nor bump the counters twice).
 */
export async function saveTrackResult(
  jobId: string,
  trackIndex: number,
  track: PlaylistTrack,
  result: Omit<PlaylistTrackResult, 'title' | 'artist'>,
  db: ReturnType<typeof getDB> = getDB(),
): Promise<void> {
  // The track-result row is the source of truth. We insert it FIRST and only
  // bump the job counters when the INSERT actually added a NEW row. A duplicate
  // `(jobId, trackIndex)` is a no-op for both the result table and the counters,
  // so a client retry or a concurrent chunk submit never over-counts
  // processed / imported / skipped / failed (ISSUE #212).
  //
  // Doing the insert first also removes the "counted but no result" window: if
  // the INSERT fails, the counters are never touched. Each write here is a
  // single short statement (no multi-statement transaction), which keeps the
  // update concurrency-safe — the pattern this codebase uses everywhere for D1
  // / libsql writes (see ai-usage.ts, sync-write.ts).
  //
  // `(jobId, trackIndex)` is unique via `playlist_import_track_results_job_track_idx`
  // (migration 0022 / `repairPlaylistImportSlotIdentity()`).
  const inserted = await db.insert(schema.playlistImportTrackResults).values({
    jobId,
    spotifyTrackId: track.id,
    trackIndex,
    title: track.title,
    artist: track.artist,
    status: result.status,
    needsReview: result.needsReview ? 1 : 0,
  }).onConflictDoNothing().run();

  // rowsAffected: libsql · changes / meta.changes: D1 — all drivers expose the
  // affected-row count one way or another. 0 means the row already existed.
  const insertedCount = Number(
    (inserted as { rowsAffected?: number }).rowsAffected ??
    (inserted as { changes?: number }).changes ??
    (inserted as { meta?: { changes?: number } }).meta?.changes ??
    0,
  );
  if (insertedCount === 0) return; // duplicate → counters already reflect it

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
 * Look up the saved outcome of every slot that overlaps `[offset, offset+limit)`.
 *
 * Slots already handled by a previous (timed-out / cancelled) request are
 * replayed from this map on resume — without re-fetching lyrics or
 * double-counting. The map is keyed by playlist index (not Spotify track id), so
 * a playlist containing the same song twice replays both slots correctly.
 */
export async function existingResultsForChunk(
  jobId: string,
  offset: number,
  limit: number,
): Promise<Map<number, PersistedTrackResult>> {
  const results = new Map<number, PersistedTrackResult>();
  if (limit <= 0) return results;
  const db = getDB();
  const rows = await db.select({
    trackIndex: schema.playlistImportTrackResults.trackIndex,
    status: schema.playlistImportTrackResults.status,
    needsReview: schema.playlistImportTrackResults.needsReview,
  })
    .from(schema.playlistImportTrackResults)
    .where(and(
      eq(schema.playlistImportTrackResults.jobId, jobId),
      gte(schema.playlistImportTrackResults.trackIndex, offset),
      lt(schema.playlistImportTrackResults.trackIndex, offset + limit),
    ))
    .all();
  for (const row of rows) {
    results.set(row.trackIndex, {
      status: row.status as TrackStatus,
      needsReview: !!row.needsReview,
    });
  }
  return results;
}

/**
 * Read back every persisted slot of a job for a resume (GET handler) and work
 * out the slot the client must continue from.
 *
 * Rows are ordered by `track_index`, so the cursor is the offset of the first
 * missing slot. A first row that is not slot 0 means the rows cannot be
 * attributed to slots (a pre-0022 database reports a negative `resumeOffset`),
 * letting the caller refuse the resume instead of double-counting slot 0.
 */
export async function getPersistedTrackResults(
  jobId: string,
): Promise<PersistedTrackResults> {
  const db = getDB();
  const rows = await db.select({
    trackIndex: schema.playlistImportTrackResults.trackIndex,
    status: schema.playlistImportTrackResults.status,
    needsReview: schema.playlistImportTrackResults.needsReview,
  })
    .from(schema.playlistImportTrackResults)
    .where(eq(schema.playlistImportTrackResults.jobId, jobId))
    .orderBy(asc(schema.playlistImportTrackResults.trackIndex), asc(schema.playlistImportTrackResults.createdAt))
    .all();

  const results = rows.map((row: { status: string; needsReview: number }) => ({
    status: row.status as TrackStatus,
    needsReview: !!row.needsReview,
  }));

  let resumeOffset = 0;
  for (const row of rows) {
    if (row.trackIndex === resumeOffset) {
      resumeOffset += 1;
      continue;
    }
    // The first row is not slot 0 → the rows carry no usable slot mapping.
    if (resumeOffset === 0) resumeOffset = -1;
    break;
  }
  return { results, resumeOffset };
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
  let rateLimited = false;
  try {
    // Real cancellation: a per-track AbortController is wired into the chain so
    // the per-track budget (and any caller cancel) genuinely aborts the ongoing
    // provider requests instead of letting them keep running in the background
    // and burning external quota.
    const controller = new AbortController();
    const r = await withTimeout(
      fetchLyricsWithChain(track.title, track.artist, {
        spotifyTrackId: track.id,
        spotify: {
          durationMs: track.durationMs,
          album: track.album || undefined,
        },
        signal: controller.signal,
      }),
      LYRICS_FETCH_TIMEOUT_MS,
      controller,
      'lyrics fetch timeout',
    );
    lyrics = r.result;
    source = r.source;
    confidence = r.confidence;
    rateLimited = !!r.rateLimited;
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
      // A rate-limited source is not "no lyrics" — flag it so the UI can tell
      // the user to retry later instead of showing a blanket "no lyrics".
      return rateLimited ? { status: 'failed', rateLimited: true } : { status: 'failed' };
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

function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Abort the underlying work so in-flight provider requests actually stop
      // (previous behaviour only raced the promise and let the chain keep running).
      controller.abort();
      reject(new Error(label));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
