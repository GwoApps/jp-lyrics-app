import { NextResponse, type NextRequest } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
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
 *    `PLAYLIST_CHUNK_SIZE` tracks, persist outcomes, return progress.
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
  if (!jobId) {
    return NextResponse.json({ error: 'invalid_job' }, { status: 400 });
  }

  const job = await getOwnedJob(jobId, user.email);
  if (!job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status === 'completed') {
    return NextResponse.json({ job, tracks: [], nextOffset: job.total, done: true });
  }
  if (job.status === 'cancelled') {
    return NextResponse.json({ error: 'job_cancelled' }, { status: 409 });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ error: 'job_failed' }, { status: 409 });
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
      // Already handled by an earlier request — replay the saved outcome.
      trackResults.push({
        spotifyId: track.id,
        title: track.title,
        artist: track.artist,
        status: persisted.status,
        ...(persisted.needsReview ? { needsReview: true } : {}),
      });
      continue;
    }
    const result = await processTrack(user, createdByName, track);
    await saveTrackResult(jobId, trackIndex, track, result);
    trackResults.push({ spotifyId: track.id, title: track.title, artist: track.artist, ...result });
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
