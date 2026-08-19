import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { fetchLyricsWithChain } from '@/lib/lyrics-provider';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { syncStageToDynamicProviderStage as toProviderStage } from '@/lib/lyrics-fetcher';
import { getLrcTextLines, parseLrc } from '@/lib/lrc';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';
import { signCandidate, verifyCandidate } from '@/lib/candidate-token';
import type { CandidateTokenPayload } from '@/lib/candidate-token';
import { applySyncWrite, resolveSyncBaseline } from '@/lib/sync-write';

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
 * Atomically write the reviewed candidate. When called from the token path the
 * candidate (and thus the exact content) comes from the validated token; when
 * called from the fresh-sync path the candidate comes from the current request.
 *
 * Both paths persist under a compare-and-set on `lyrics_raw` (issue #120): the
 * UPDATE only matches while the stored lyrics still equal the snapshot this
 * write was based on. If another tab/session edited the lyrics meanwhile, no
 * row matches and NOTHING is persisted (no silent overwrite, no cache wipe) —
 * the same stale-source contract as the translation / furigana / timeline
 * save paths. For the token path the snapshot is the pre-preview `lyricsRaw`;
 * for the fresh path it is the request's `source_lyrics`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the Drizzle DB, the
   row object and the fetched track are typed `any` by design (see lib/db.ts). */
async function persistCandidate(
  db: any,
  id: string,
  song: any,
  candidate: CandidateTokenPayload,
  fresh?: {
    spotifyTrack?: any | null;
    sourceLyrics: string;
  },
): Promise<{ status: number; body: unknown }> {
/* eslint-enable @typescript-eslint/no-explicit-any */
  const plain = candidate.plain;
  const synced = candidate.synced;
  // A plain-text candidate has no synced LRC timeline; this drives the
  // `plainUpdated` flag the client uses to show the confirmation toast and to
  // clear the timeline view after a plain-text overwrite.
  const isPlain = !synced.trim();

  // Only wipe the derived caches (furigana / translation / glossary) when the
  // fetched lyric text actually differs from what is currently stored. Re-syncing
  // the same lyrics — e.g. just to refresh LRC timestamps or fix the source — must
  // not erase manual furigana corrections, consumed AI translation quota, or the
  // confirmed reading scheme (matches the content-aware PUT route behaviour).
  const contentChanged = getLrcTextLines(plain).join('\n')
    !== getLrcTextLines(song.lyricsRaw).join('\n');

  // CAS write: the UPDATE only matches while `lyrics_raw` still equals the
  // snapshot this request was based on. If another tab/session edited the
  // lyrics while the fetch/confirmation was in flight, no row matches and
  // NOTHING is persisted (no silent overwrite, no cache wipe).
  const write = await applySyncWrite(db, {
    id,
    sourceLyrics: fresh?.sourceLyrics ?? song.lyricsRaw,
    patch: {
      lyricsRaw: plain,
      lyricsSynced: synced,
      lyricsSource: candidate.source,
      lyricsConfidence: candidate.confidence,
      // Everything written through this route was either accepted outright or
      // explicitly confirmed by the user — never leave the review flag set.
      lyricsNeedsReview: 0,
      lyricsFetchedAt: new Date().toISOString(),
      ...(contentChanged ? {
        lyricsFurigana: '[]',
        lyricsTranslation: '[]',
        lyricsTranslationReasoning: null,
        lyricsGlossary: null,
        // The Cantonese-detection banner only applies to the kana scheme; when the
        // lyrics changed under it, re-prompt the user (same as the PUT route).
        readingSchemeConfirmed: song.readingScheme === 'ja-kana' ? 0 : undefined,
      } : {}),
      ...(fresh?.spotifyTrack ? {
        spotifyTrackId: fresh.spotifyTrack.id,
        spotifyUri: fresh.spotifyTrack.uri,
        spotifyAlbum: fresh.spotifyTrack.album,
        spotifyDurationMs: fresh.spotifyTrack.durationMs,
        spotifyCanonicalTitle: fresh.spotifyTrack.title,
        spotifyCanonicalArtist: fresh.spotifyTrack.artist,
        coverUrl: fresh.spotifyTrack.coverUrl,
      } : {}),
    },
  });

  if (!write.ok) {
    return { status: 409, body: { synced: false, error: 'stale_source' } };
  }

  const parsed = synced ? parseLrc(synced) : [];
  return {
    status: 200,
    body: {
      synced: parsed.length > 0,
      plainUpdated: isPlain,
      source: candidate.source,
      confidence: candidate.confidence,
      lines: parsed.length,
      lrc: synced,
      spotify_track_id: fresh?.spotifyTrack?.id ?? null,
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle row is `any` (see lib/db.ts). */
interface FreshSyncArgs {
  userEmail: string;
  db: any;
  id: string;
  song: any;
  body: {
    force?: boolean;
    confirmPlain?: boolean;
  };
  sourceLyrics: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Run the full (re)sync chain: fetch from all sources in order and classify the
 * result into the same outcome the previous JSON-only route produced
 * (plain-hit / low-confidence preview / direct write / not-found / rate-limit).
 * Returns a plain `{ status, body }` so it can be served either as a regular
 * JSON response or, when the caller wants SSE, wrapped into a `result` event.
 *
 * The optional `onStage` callback is forwarded to `fetchLyrics` so the SSE
 * path can emit live "querying source…" progress lines.
 */
async function runFreshSync(
  args: FreshSyncArgs,
  onStage?: (stage: string | ProviderStage) => void,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const { userEmail, db, id, song, body, sourceLyrics } = args;

  const spotifyTrack = (song.spotifyTrackId ? await getSpotifyTrack(userEmail, song.spotifyTrackId) : null)
    || await searchSpotifyTrack(userEmail, song.title, song.artist);
  const spotifyCanonical = spotifyTrack
    ? { name: spotifyTrack.title, artist: spotifyTrack.artist }
    : null;
  // Route through the effective chain (builtin + admin HTTP providers). The
  // chain applies its own 180s budget, but the caller's AbortSignal (user
  // cancel / SSE disconnect) always wins and stops remaining requests.
  const { result, source, confidence, durationMismatch, match, rateLimited } = await fetchLyricsWithChain(song.title, song.artist, {
    spotifyCanonical,
    spotifyTrackId: spotifyTrack?.id ?? null,
    spotify: spotifyTrack
      ? { durationMs: spotifyTrack.durationMs, album: spotifyTrack.album }
      : undefined,
    onStage,
    signal,
  });

  if (!result) {
    // Distinguish a rate-limited lyric source (retry later) from a song that
    // genuinely has no lyrics — reusing "not found" for 429 was misleading.
    if (rateLimited) {
      return { status: 503, body: { synced: false, error: 'lyrics_rate_limited' } };
    }
    return { status: 404, body: { synced: false, error: 'lyrics_not_found' } };
  }

  const { force, confirmPlain } = body;

  // Plain-text hit (no LRC timeline) — any such candidate would destroy
  // existing lyrics (timed or manually entered), so it needs explicit
  // confirmation regardless of source.
  const isPlainHit = !result.synced.trim();
  const hasExistingLyrics = !!song.lyricsRaw.trim() || !!song.lyricsSynced.trim();

  // Unified quality gate shared with import / import-playlist. The decision now
  // depends on actual confidence (and match evidence), not the source string.
  const verdict = classifyLyricsHit({
    source,
    confidence,
    synced: !isPlainHit,
    hasExistingTimeline: hasExistingLyrics,
    durationMismatch,
  });

  // Below the hard floor → wrong candidate; never persist it silently.
  if (verdict === 'rejected') {
    return {
      status: 404,
      body: {
        synced: false,
        error: 'lyrics_rejected',
        source,
        confidence,
        lines: isPlainHit ? 0 : parseLrc(result.synced).length,
      },
    };
  }

  // Build the signed candidate so the later confirmation writes THIS exact
  // preview (bound to the song's current updatedAt to detect concurrent edits).
  const makeCandidate = (): Promise<string> => signCandidate({
    song: id,
    source,
    confidence,
    plain: result.plain,
    synced: result.synced,
    updatedAt: song.updatedAt,
  });

  // Plain-text hit (no LRC timeline) — do NOT silently overwrite stored lyrics /
  // timeline. Unless the user explicitly confirms via a valid candidate token,
  // keep the current lyrics untouched and ask — otherwise an existing LRC
  // timeline, manual furigana and consumed AI translation quota would be lost
  // unnoticed. We now hand back a signed token so the later confirmation writes
  // THIS exact candidate.
  if (isPlainHit && !confirmPlain) {
    const candidate = await makeCandidate();
    return {
      status: 200,
      body: {
        synced: false,
        plainHit: true,
        source,
        confidence,
        plain: result.plain,
        candidate,
        match,
      },
    };
  }

  // Risky (below threshold) match — return the candidate summary and let the
  // user decide. Current lyrics stay untouched until they confirm via the token.
  if (verdict === 'needs_review' && !force) {
    const parsed = result.synced ? parseLrc(result.synced) : [];
    const candidate = await makeCandidate();
    return {
      status: 200,
      body: {
        synced: false,
        lowConfidence: true,
        source,
        confidence,
        lines: parsed.length,
        lrc: result.synced,
        candidate,
        match,
      },
    };
  }

  // Direct "sync with override" call (force / confirmPlain without a token) —
  // writes the freshly fetched candidate. The write runs under the
  // `source_lyrics` compare-and-set so a lyrics edit landing mid-flight can
  // never be silently clobbered (issue #120).
  return persistCandidate(db, id, song, {
    song: id,
    source,
    confidence,
    plain: result.plain,
    synced: result.synced,
    updatedAt: song.updatedAt,
  }, {
    spotifyTrack,
    sourceLyrics,
  });
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
