import { fetchLyricsWithChain } from '@/lib/lyrics-provider';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { getLrcTextLines, parseLrc } from '@/lib/lrc';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';
import { signCandidate, type CandidateTokenPayload } from '@/lib/candidate-token';
import { applySyncWrite } from '@/lib/sync-write';

/**
 * Single-song (re)sync business logic (issue #148 / #120).
 *
 * Kept out of the route so the fetch → classify → persist decision flow can be
 * shared between the plain-JSON and SSE paths without re-importing HTTP types.
 * Both the token-confirmation path and the fresh-sync path persist under a
 * compare-and-set on `lyrics_raw`, so a concurrent lyrics edit can never be
 * silently clobbered.
 */

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
export async function persistCandidate(
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
export async function runFreshSync(
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
