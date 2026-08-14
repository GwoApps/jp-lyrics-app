import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { fetchLyrics } from '@/lib/lyrics-fetcher';
import { getLrcTextLines, parseLrc } from '@/lib/lrc';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';
import { signCandidate, verifyCandidate } from '@/lib/candidate-token';
import type { CandidateTokenPayload } from '@/lib/candidate-token';

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
    // no longer matches and the candidate is rejected as stale.
    return persistCandidate(db, schema, eq, sql, id, song, candidate);
  }

  // === Full (re)sync path — only used for a fresh preview ===
  const spotifyTrack = (song.spotifyTrackId ? await getSpotifyTrack(user.email, song.spotifyTrackId) : null)
    || await searchSpotifyTrack(user.email, song.title, song.artist);
  const spotifyCanonical = spotifyTrack
    ? { name: spotifyTrack.title, artist: spotifyTrack.artist }
    : null;
  const { result, source, confidence, durationMismatch, match } = await fetchLyrics(song.title, song.artist, {
    spotifyCanonical,
    spotify: spotifyTrack
      ? { durationMs: spotifyTrack.durationMs, album: spotifyTrack.album }
      : undefined,
  });

  if (!result) {
    return NextResponse.json({ synced: false, error: 'lyrics_not_found' }, { status: 404 });
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
    return NextResponse.json({
      synced: false,
      error: 'lyrics_rejected',
      source,
      confidence,
      lines: isPlainHit ? 0 : parseLrc(result.synced).length,
    }, { status: 404 });
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
    return NextResponse.json({
      synced: false,
      plainHit: true,
      source,
      confidence,
      plain: result.plain,
      candidate,
      match,
    });
  }

  // Risky (below threshold) match — return the candidate summary and let the
  // user decide. Current lyrics stay untouched until they confirm via the token.
  if (verdict === 'needs_review' && !force) {
    const parsed = result.synced ? parseLrc(result.synced) : [];
    const candidate = await makeCandidate();
    return NextResponse.json({
      synced: false,
      lowConfidence: true,
      source,
      confidence,
      lines: parsed.length,
      lrc: result.synced,
      candidate,
      match,
    });
  }

  // Direct "sync with override" call (force / confirmPlain without a token) —
  // writes the freshly fetched candidate.
  return persistCandidate(db, schema, eq, sql, id, song, {
    song: id,
    source,
    confidence,
    plain: result.plain,
    synced: result.synced,
    updatedAt: song.updatedAt,
  }, {
    spotifyTrack,
  });
}

/**
 * Atomically write the reviewed candidate. When called from the token path the
 * candidate (and thus the exact content) comes from the validated token; when
 * called from the fresh-sync path the candidate comes from the current request.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the Drizzle DB, schema,
   eq/sql helpers and the row object are typed `any` by design (see lib/db.ts). */
async function persistCandidate(
  db: any,
  schema: any,
  eq: any,
  sql: any,
  id: string,
  song: any,
  candidate: CandidateTokenPayload,
  fresh?: {
    spotifyTrack: any | null;
  },
) {
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

  await db.update(schema.songs).set({
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
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id));

  const parsed = synced ? parseLrc(synced) : [];
  return NextResponse.json({
    synced: parsed.length > 0,
    plainUpdated: isPlain,
    source: candidate.source,
    confidence: candidate.confidence,
    lines: parsed.length,
    lrc: synced,
    spotify_track_id: fresh?.spotifyTrack?.id ?? null,
  });
}
