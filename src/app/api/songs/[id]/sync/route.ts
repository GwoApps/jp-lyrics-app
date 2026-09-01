import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { syncStageToDynamicProviderStage as toProviderStage } from '@/lib/lyrics-fetcher';
import { verifyCandidate } from '@/lib/candidate-token';
import { resolveSyncBaseline } from '@/lib/sync-write';
import { persistCandidate, runFreshSync } from '@/lib/sync-service';

/**
 * Convert a `{ status, body }` result into a JSON response. Used so the
 * fresh-sync decision logic can be shared between the plain-JSON path and the
 * SSE path (which wraps the same result in a `result` event).
 */
function toNextResponse(result: { status: number; body: unknown }): NextResponse {
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const song = await db.select({
    id: schema.songs.id,
    title: schema.songs.title,
    artist: schema.songs.artist,
    lyricsRaw: schema.songs.lyricsRaw,
    lyricsSynced: schema.songs.lyricsSynced,
    readingScheme: schema.songs.readingScheme,
    spotifyTrackId: schema.songs.spotifyTrackId,
    createdBy: schema.songs.createdBy,
    updatedAt: schema.songs.updatedAt,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();

  if (!song) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && song.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    force?: boolean;
    confirmPlain?: boolean;
    candidate?: string;
    source_lyrics?: unknown;
  };

  // === Candidate-confirmation fast path ===
  //
  // When the user confirms a low-confidence / plain-text candidate they were
  // shown earlier, the request carries only the `candidate` token. We validate
  // it and atomically persist EXACTLY the reviewed candidate — we do NOT
  // re-fetch from third-party sources, so the written content is guaranteed to
  // match what the user saw (fixes the TOCTOU in the previous force-based flow).
  if (body.candidate) {
    const verdict = await verifyCandidate(body.candidate);
    if (!verdict.ok) {
      return NextResponse.json({
        synced: false,
        error: verdict.reason === 'expired' ? 'candidate_expired' : 'candidate_invalid',
      }, { status: 409 });
    }

    const candidate = verdict.payload;
    // The token is bound to this song.
    if (candidate.song !== id) {
      return NextResponse.json({
        synced: false,
        error: 'candidate_invalid',
      }, { status: 409 });
    }

    // Reject if the song was edited after the candidate was previewed — the
    // token would silently clobber a newer edit (stale_source).
    if (song.updatedAt !== candidate.updatedAt) {
      return NextResponse.json({
        synced: false,
        error: 'stale_source',
      }, { status: 409 });
    }

    // The candidate was never written during preview (it is pending review), so
    // the stored `lyricsRaw` is still the pre-preview content. The `updatedAt`
    // bound in the token is the authoritative guard against a concurrent edit:
    // if any edit (lyrics or metadata) landed after the preview, `updatedAt`
    // no longer matches and the candidate is rejected as stale. The write below
    // additionally runs as a compare-and-set on `lyrics_raw` (issue #120), so a
    // lyrics edit that lands between this check and the write can never be
    // silently clobbered either.
    return toNextResponse(await persistCandidate(db, id, song, candidate, {
      sourceLyrics: song.lyricsRaw,
    }));
  }

  // === Full (re)sync path — only used for a fresh preview ===

  // The client submits the `lyrics_raw` snapshot its sync request was based on
  // (same contract as the furigana / translation / timeline saves). When the
  // snapshot is missing the request is malformed; when it no longer matches the
  // stored lyrics, another tab/session already rewrote the song and syncing
  // from this stale baseline would silently clobber the newer lyrics AND wipe
  // its derived caches. Fail fast BEFORE spending a fetch (issue #120).
  const baseline = resolveSyncBaseline(body.source_lyrics, song.lyricsRaw);
  if (!baseline.ok) {
    return NextResponse.json({ synced: false, error: baseline.error }, {
      status: baseline.error === 'missing_source_lyrics' ? 400 : 409,
    });
  }
  const { sourceLyrics } = baseline;

  const wantSse = request.headers.get('accept')?.includes('text/event-stream') ?? false;
  // The SSE stream passes its own AbortSignal so a client disconnect / cancel
  // actually aborts the in-flight fetch and the remaining provider chain
  // (issue #148 hardening). The plain-JSON path uses the request signal.
  const run = (opts?: {
    onStage?: (stage: string | ProviderStage) => void;
    signal?: AbortSignal;
  }) => runFreshSync({
    userEmail: user.email,
    db,
    id,
    song,
    body,
    sourceLyrics,
  }, opts?.onStage, opts?.signal ?? request.signal);

  // When the client opts into Server-Sent Events, stream per-source stage
  // updates ("正在查询 LRCLIB…" etc.) and finish with a single `result` event
  // carrying the same payload the plain-JSON path would return. This gives the
  // long multi-source fetch a live progress line and a cancel affordance
  // instead of a frozen spinner (issue #129).
  if (wantSse) {
    return sseResponse(run);
  }
  return toNextResponse(await run());
}


/**
 * Wrap a fresh-sync run in a Server-Sent Events stream. Each source the fetch
 * chain hits is emitted as a `stage` event (`data: {"stage":"lrclib"}`), then a
 * single `result` event carries the final `{ status, body }`. An error mid-fetch
 * (e.g. an unexpected exception) is surfaced as an `error` event with a generic
 * network message so the client can stop the spinner cleanly.
 */
function sseResponse(
  run: (opts?: {
    onStage?: (stage: string | ProviderStage) => void;
    signal?: AbortSignal;
  }) => Promise<{ status: number; body: unknown }>,
): Response {
  const encoder = new TextEncoder();
  // Abort the underlying fetch chain when the client disconnects (SSE cancel).
  const abortController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await run({
          signal: abortController.signal,
          onStage: (stage) => {
            // Emit the legacy string for builtin stages (backward compatible)
            // and the dynamic `{ id, displayName, kind }` object for plugins.
            if (typeof stage === 'string') {
              write('stage', { stage: toProviderStage(stage) });
            } else {
              write('stage', stage);
            }
          },
        });
        write('result', result);
      } catch {
        if (abortController.signal.aborted) {
          // Client disconnected — no need to write anything; just close.
        } else {
          write('error', { status: 500, body: { synced: false, error: 'network_error' } });
        }
      } finally {
        controller.close();
      }
    },
    async cancel() {
      abortController.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
