import { NextResponse, type NextRequest } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import {
  PLAYLIST_CHUNK_SIZE,
  PLAYLIST_MAX_TRACKS,
  createJob,
  existingResultsForChunk,
  extractPlaylistId,
  fetchPlaylistTracks,
  finishJob,
  getOwnedJob,
  listTrackResults,
  processTrack,
  requireSpotifyToken,
  saveTrackResult,
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
  const tracks = await listTrackResults(jobId);
  return NextResponse.json({ job, tracks });
}

// POST — create an import job (fetch playlist metadata only, no lyrics).
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const { playlistUrl } = await request.json();
  const playlistId = extractPlaylistId(playlistUrl || '');
  if (!playlistId) {
    return NextResponse.json({ error: 'invalid_playlist_url' }, { status: 400 });
  }

  const accessToken = await requireSpotifyToken(user.email);
  let tracks: PlaylistTrack[];
  try {
    tracks = await fetchPlaylistTracks(playlistId, accessToken);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status && status !== 200) {
      return NextResponse.json({ error: 'playlist_fetch_failed' }, { status });
    }
    return NextResponse.json({ error: 'playlist_fetch_failed' }, { status: 502 });
  }

  if (tracks.length === 0) {
    return NextResponse.json({ error: 'playlist_empty' }, { status: 400 });
  }

  const job = await createJob(user, playlistId, tracks);

  return NextResponse.json({
    job,
    // Cap notice so large playlists degrade gracefully instead of timing out.
    truncated: tracks.length >= PLAYLIST_MAX_TRACKS,
    maxTracks: PLAYLIST_MAX_TRACKS,
    chunkSize: PLAYLIST_CHUNK_SIZE,
  });
}

// PUT — process one chunk of an existing job. Body: { jobId, offset }.
// Resumable: tracks already saved are skipped; returns the next offset.
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const body = await request.json();
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  const offset = Number.isFinite(body.offset) ? Math.max(0, Math.floor(body.offset)) : 0;
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

  const accessToken = await requireSpotifyToken(user.email);

  // Resolve the playlist again on each chunk — a token refresh mid-import must
  // not lose the track list, and D1 rows are cheap.
  let tracks: PlaylistTrack[];
  try {
    tracks = await fetchPlaylistTracks(job.playlistId, accessToken);
  } catch {
    return NextResponse.json({ error: 'playlist_fetch_failed' }, { status: 502 });
  }

  if (offset >= tracks.length) {
    await finishJob(jobId, 'completed');
    const done = await getOwnedJob(jobId, user.email);
    return NextResponse.json({ job: done, tracks: [], nextOffset: tracks.length, done: true });
  }

  // Idempotency: replay tracks whose outcome was already persisted. This is what
  // makes a chunk that timed out mid-way resumable — already-saved tracks are
  // replayed from the job's track table instead of re-fetching lyrics.
  const alreadyDone = await existingResultsForChunk(jobId, tracks);

  const chunk = tracks.slice(offset, offset + PLAYLIST_CHUNK_SIZE);
  const trackResults: PlaylistTrackResultDTO[] = [];

  const db = getDB();
  const nameRow = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(eq(schema.spotifyAuth.userEmail, user.email))
    .get();
  const createdByName = nameRow?.displayName || '';

  // Process the chunk; a timeout may fire mid-chunk, so persist each track's
  // outcome as soon as it completes (saveTrackResult is idempotent).
  for (const track of chunk) {
    const persisted = alreadyDone.get(track.id);
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
    await saveTrackResult(jobId, track, result);
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
