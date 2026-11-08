import { NextResponse, type NextRequest } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser, type AuthUser } from '@/lib/auth';
import { parseJsonBody } from '@/lib/admin';
import {
  PLAYLIST_CHUNK_SIZE,
  spotifyUpstreamFailure,
  PLAYLIST_MAX_TRACKS,
  createJob,
  existingResultsForChunk,
  extractPlaylistId,
  fetchPlaylistTrackPage,
  finishJob,
  getOwnedJob,
  getPersistedTrackResults,
  listFailedTrackSlots,
  listTrackResults,
  PLAYLIST_IMPORT_RESUME_UNSUPPORTED,
  processTrack,
  requireSpotifyToken,
  saveTrackResult,
  type PlaylistFetch,
  type PlaylistJobSummary,
  type PlaylistTrack,
} from '@/lib/playlist-import';

export const dynamic = 'force-dynamic';

/**
 * Playlist import is now job-based instead of one giant HTTP request:
 *
 *  - `POST  /api/songs/import-playlist`  — resolve the Spotify playlist, create
 *    a job and return its id. No lyrics fetching happens here.
 *  - `PUT   /api/songs/import-playlist`  — process one chunk of up to
 *    `PLAYLIST_CHUNK_SIZE` tracks, persist outcomes, return progress. Sending
 *    `{ retryFailed: true }` instead of `offset` re-runs the slots that failed
 *    because the sources were rate-limited (ISSUE #325) — that is what makes
 *    "retry them later" real rather than a promise the UI cannot keep.
 *  - `DELETE /api/songs/import-playlist` — cancel a job.
 *
 * A single Worker request is therefore bounded in time and subrequests; the
 * client drives chunks and can resume after a timeout, cancel, or refresh.
 */

interface PlaylistTrackResultDTO {
  spotifyId: string;
  title: string;
  artist: string;
  status: 'imported' | 'skipped' | 'failed';
  source?: string;
  synced?: boolean;
  needsReview?: boolean;
  rateLimited?: boolean;
  /** Playlist slot the outcome belongs to — the identity the client merges on. */
  trackIndex: number;
}

// GET — fetch the current state of a job plus all persisted per-track outcomes.
// Used to rebuild the summary after a page refresh / resume.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const jobId = request.nextUrl.searchParams.get('jobId') || '';
  if (!jobId) {
    return NextResponse.json({ error: 'invalid_job' }, { status: 400 });
  }
  const job = await getOwnedJob(jobId, user.email);
  if (!job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  const persisted = await getPersistedTrackResults(jobId);
  const tracks = await listTrackResults(jobId);
  if (persisted.resumeOffset < 0) {
    // Rows written before migration 0022 cannot be mapped to a playlist slot.
    // The client needs that mapping to know where to continue, so refuse the
    // resume rather than continue from a guessed offset.
    return NextResponse.json(
      { error: PLAYLIST_IMPORT_RESUME_UNSUPPORTED, job, tracks },
      { status: 409 },
    );
  }
  // `resumeOffset` is the first pending slot, i.e. the client's cursor.
  return NextResponse.json({ job, tracks, resumeOffset: persisted.resumeOffset });
}

// POST — create an import job (fetch playlist metadata only, no lyrics).
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { playlistUrl } = parsed as { playlistUrl?: unknown };
  const playlistId = extractPlaylistId(typeof playlistUrl === 'string' ? playlistUrl : '');
  if (!playlistId) {
    return NextResponse.json({ error: 'invalid_playlist_url' }, { status: 400 });
  }

  let playlist: PlaylistFetch;
  try {
    const accessToken = await requireSpotifyToken(user.email);
    playlist = await fetchPlaylistTrackPage(playlistId, accessToken);
  } catch (error) {
    // A stalled Spotify (token refresh or playlist page) now fails fast with a
    // retryable code instead of leaving the request pending (issue #370).
    const failure = spotifyUpstreamFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    const status = (error as Error & { status?: number }).status;
    if (status && status !== 200) {
      return NextResponse.json({ error: 'playlist_fetch_failed' }, { status });
    }
    return NextResponse.json({ error: 'playlist_fetch_failed' }, { status: 502 });
  }
  const { tracks } = playlist;

  if (tracks.length === 0) {
    return NextResponse.json({ error: 'playlist_empty' }, { status: 400 });
  }

  const job = await createJob(user, playlistId, tracks);

  return NextResponse.json({
    job,
    // Cap notice so large playlists degrade gracefully instead of timing out.
    // `truncated` used to be `tracks.length >= PLAYLIST_MAX_TRACKS`, which also
    // fired for a playlist of exactly maxTracks (nothing dropped). It now comes
    // from what Spotify reported (`total` + the `next` page marker), so the cap
    // is decidable and quantifiable instead of a boolean guess (ISSUE #324).
    truncated: playlist.truncated,
    maxTracks: PLAYLIST_MAX_TRACKS,
    chunkSize: PLAYLIST_CHUNK_SIZE,
    // Additive, optional fields — existing callers that only read job/truncated
    // /maxTracks/chunkSize keep working unchanged.
    playlistTotal: playlist.playlistTotal,
    dropped: playlist.dropped,
    mayHaveMore: playlist.mayHaveMore,
  });
}

// PUT — process one chunk of an existing job. Body: { jobId, offset }.
// Resumable: tracks already saved are skipped; returns the next offset.
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  const offset = typeof body.offset === 'number' && Number.isFinite(body.offset) ? Math.max(0, Math.floor(body.offset)) : 0;
  // ISSUE #325: instead of walking the playlist, re-run the slots whose sources
  // were rate-limited. Those failures are recoverable, so "resume later to retry"
  // (what the UI promises) needs a path that actually re-fetches them.
  const retryFailed = body.retryFailed === true;
  const retryAfter = typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter)
    ? Math.floor(body.retryAfter)
    : -1;
  if (!jobId) {
    return NextResponse.json({ error: 'invalid_job' }, { status: 400 });
  }

  const job = await getOwnedJob(jobId, user.email);
  if (!job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status === 'cancelled') {
    return NextResponse.json({ error: 'job_cancelled' }, { status: 409 });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ error: 'job_failed' }, { status: 409 });
  }
  // Retry is allowed on a completed job on purpose: the recoverable failures are
  // exactly the ones the job finished with.
  if (retryFailed) {
    return retryRateLimitedSlots(job, user, retryAfter);
  }
  if (job.status === 'completed') {
    return NextResponse.json({ job, tracks: [], nextOffset: job.total, done: true });
  }

  // Resolve the playlist again on each chunk — a token refresh mid-import must
  // not lose the track list, and D1 rows are cheap.
  let tracks: PlaylistTrack[];
  try {
    const accessToken = await requireSpotifyToken(user.email);
    ({ tracks } = await fetchPlaylistTrackPage(job.playlistId, accessToken));
  } catch (error) {
    // Keep the chunk resumable: nothing was written, so a retry replays it.
    const failure = spotifyUpstreamFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: 'playlist_fetch_failed' }, { status: 502 });
  }

  if (offset >= tracks.length) {
    await finishJob(jobId, 'completed');
    const done = await getOwnedJob(jobId, user.email);
    return NextResponse.json({ job: done, tracks: [], nextOffset: tracks.length, done: true });
  }

  const chunk = tracks.slice(offset, offset + PLAYLIST_CHUNK_SIZE);

  // Idempotency: replay the slots whose outcome was already persisted. This is
  // what makes a chunk that timed out mid-way resumable — already-saved slots
  // are replayed from the job's track table instead of re-fetching lyrics.
  // Keyed by playlist index (ISSUE #347): a playlist may contain the same song
  // twice, and both slots must be replayed as the separate rows they are.
  const alreadyDone = await existingResultsForChunk(jobId, offset, chunk.length);

  const trackResults: PlaylistTrackResultDTO[] = [];

  const db = getDB();
  const nameRow = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(eq(schema.spotifyAuth.userEmail, user.email))
    .get();
  const createdByName = nameRow?.displayName || '';

  // Process the chunk; a timeout may fire mid-chunk, so persist each track's
  // outcome as soon as it completes (saveTrackResult is idempotent).
  for (let i = 0; i < chunk.length; i += 1) {
    const track = chunk[i];
    // Playlist slot = the index this chunk was sliced at. It never changes for
    // a given request, so replaying the chunk after a timeout re-derives the
    // exact same slot and `saveTrackResult` stays a no-op for done slots.
    const trackIndex = offset + i;
    const persisted = alreadyDone.get(trackIndex);
    if (persisted) {
      // Already handled by an earlier request — replay the saved outcome,
      // including the persisted reason (ISSUE #325): a rate-limited slot must
      // still report `rateLimited` after a resume, or the UI silently turns a
      // recoverable failure into "no lyrics".
      trackResults.push({
        spotifyId: track.id,
        title: track.title,
        artist: track.artist,
        trackIndex,
        status: persisted.status,
        ...(persisted.needsReview ? { needsReview: true } : {}),
        ...(persisted.rateLimited ? { rateLimited: true } : {}),
      });
      continue;
    }
    const result = await processTrack(user, createdByName, track);
    await saveTrackResult(jobId, trackIndex, track, result);
    trackResults.push({ spotifyId: track.id, title: track.title, artist: track.artist, trackIndex, ...result });
  }

  // Resume cursor: advance past every track we just handled (whether fresh or
  // already-done), so a subsequent request starts at the next unprocessed one.
  const nextOffset = Math.min(tracks.length, offset + PLAYLIST_CHUNK_SIZE);
  const isDone = nextOffset >= tracks.length;
  if (isDone) {
    await finishJob(jobId, 'completed');
  }

  const summary = await getOwnedJob(jobId, user.email);
  return NextResponse.json({
    job: summary,
    tracks: trackResults,
    nextOffset,
    done: isDone,
  });
}

/**
 * Re-run the slots that failed *because the sources were rate-limited* (#325).
 *
 * The retry walks the persisted failures in slot order, one bounded batch per
 * request (`PLAYLIST_CHUNK_SIZE`, same budget as a normal chunk) and honours the
 * `retryAfter` cursor the client sends back. Only `rateLimited` failures are
 * retried: they are the recoverable ones — "no lyrics found" would just burn the
 * same upstream quota to reach the same answer, and the copy for those stays
 * truthful.
 *
 * Unlike a resume, a retry deliberately ignores the replay set: the existing row
 * is UPDATED (`overwrite`) and the job counters are recounted from the result
 * table, so a slot flipping failed → imported keeps `processed` equal to `total`
 * instead of counting the slot twice.
 */
async function retryRateLimitedSlots(
  job: PlaylistJobSummary,
  user: AuthUser,
  retryAfter: number,
): Promise<NextResponse> {
  const failed = await listFailedTrackSlots(job.id);
  const pending = failed
    .filter((slot) => slot.rateLimited && slot.trackIndex > retryAfter)
    .map((slot) => slot.trackIndex);

  if (pending.length === 0) {
    // Nothing left to retry — report the job as it stands, plus a marker so the
    // client can stop looping instead of guessing from an empty track list.
    const summary = await getOwnedJob(job.id, user.email);
    return NextResponse.json({ job: summary, tracks: [], done: true, retried: 0, remaining: 0 });
  }

  let tracks: PlaylistTrack[];
  try {
    const accessToken = await requireSpotifyToken(user.email);
    ({ tracks } = await fetchPlaylistTrackPage(job.playlistId, accessToken));
  } catch (error) {
    const failure = spotifyUpstreamFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: 'playlist_fetch_failed' }, { status: 502 });
  }

  const db = getDB();
  const nameRow = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(eq(schema.spotifyAuth.userEmail, user.email))
    .get();
  const createdByName = nameRow?.displayName || '';

  const batch = pending.slice(0, PLAYLIST_CHUNK_SIZE);
  const trackResults: PlaylistTrackResultDTO[] = [];
  let cursor = retryAfter;
  for (const trackIndex of batch) {
    cursor = trackIndex;
    const track = tracks[trackIndex];
    // The playlist shrank since the import: the slot no longer exists, so there
    // is nothing to re-fetch. Leave the persisted row alone and move on.
    if (!track) continue;
    const result = await processTrack(user, createdByName, track);
    await saveTrackResult(job.id, trackIndex, track, result, db, { overwrite: true });
    trackResults.push({ spotifyId: track.id, title: track.title, artist: track.artist, trackIndex, ...result });
  }

  const remaining = pending.length - batch.length;
  const done = remaining === 0;
  // The job keeps its status around the retry — only the counters change, and
  // they are recounted per save, so the summary never drifts from the rows.
  const summary = await getOwnedJob(job.id, user.email);
  return NextResponse.json({
    job: summary,
    tracks: trackResults,
    done,
    retried: trackResults.length,
    remaining,
    retryAfter: cursor,
  });
}

// DELETE — cancel a job (keeps already-imported songs; marks the job cancelled).
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId') || '';
  if (!jobId) {
    return NextResponse.json({ error: 'invalid_job' }, { status: 400 });
  }

  const job = await getOwnedJob(jobId, user.email);
  if (!job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status !== 'completed') {
    await finishJob(jobId, 'cancelled');
  }
  const summary: PlaylistJobSummary | null = await getOwnedJob(jobId, user.email);
  return NextResponse.json({ job: summary });
}
