import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { fetchLyrics } from '@/lib/lyrics-fetcher';
import { getLrcTextLines, parseLrc } from '@/lib/lrc';
import { classifyLyricsHit } from '@/lib/lyrics-hit';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';

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
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();

  if (!song) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && song.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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

  const { force, confirmPlain } = await request.json().catch(() => ({})) as {
    force?: boolean;
    confirmPlain?: boolean;
  };

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

  // Plain-text hit (no LRC timeline) — do NOT silently overwrite stored lyrics /
  // timeline. Unless the user explicitly confirms (`confirmPlain`), keep the
  // current lyrics untouched and ask — otherwise an existing LRC timeline,
  // manual furigana and consumed AI translation quota would be lost unnoticed.
  if (isPlainHit && !confirmPlain) {
    return NextResponse.json({
      synced: false,
      plainHit: true,
      source,
      confidence,
      plain: result.plain,
      match,
    });
  }

  // Risky (below threshold) match — return the candidate summary and let the
  // user decide. Current lyrics stay untouched until they confirm (`force`).
  if (verdict === 'needs_review' && !force) {
    const parsed = result.synced ? parseLrc(result.synced) : [];
    return NextResponse.json({
      synced: false,
      lowConfidence: true,
      source,
      confidence,
      lines: parsed.length,
      lrc: result.synced,
      match,
    });
  }

  // Only wipe the derived caches (furigana / translation / glossary) when the
  // fetched lyric text actually differs from what is currently stored. Re-syncing
  // the same lyrics — e.g. just to refresh LRC timestamps or fix the source — must
  // not erase manual furigana corrections, consumed AI translation quota, or the
  // confirmed reading scheme (matches the content-aware PUT route behaviour).
  const contentChanged = getLrcTextLines(result.plain).join('\n')
    !== getLrcTextLines(song.lyricsRaw).join('\n');

  await db.update(schema.songs).set({
    lyricsRaw: result.plain,
    lyricsSynced: result.synced,
    lyricsSource: source,
    lyricsConfidence: confidence,
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
    ...(spotifyTrack ? {
      spotifyTrackId: spotifyTrack.id,
      spotifyUri: spotifyTrack.uri,
      spotifyAlbum: spotifyTrack.album,
      spotifyDurationMs: spotifyTrack.durationMs,
      spotifyCanonicalTitle: spotifyTrack.title,
      spotifyCanonicalArtist: spotifyTrack.artist,
      coverUrl: spotifyTrack.coverUrl,
    } : {}),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id));

  const parsed = result.synced ? parseLrc(result.synced) : [];
  return NextResponse.json({
    synced: parsed.length > 0,
    plainUpdated: isPlainHit,
    source,
    confidence,
    lines: parsed.length,
    lrc: result.synced,
    spotify_track_id: spotifyTrack?.id ?? null,
  });
}
