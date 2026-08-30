import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { and, eq, or } from 'drizzle-orm';
import type { CoverPaletteJson, Song } from '@/lib/types';
import { getAuthUser } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';
import { resolveLrcTextUpdate, findLrcConflicts, resolveTimelineSave } from '@/lib/lrc';
import type { ReadingScheme } from '@/lib/types';

/** Strip internal email while exposing server-authoritative capabilities. */
function sanitizeSong(song: Song, canEdit: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { created_by, ...rest } = song;
  return { ...rest, permissions: { can_edit: canEdit } };
}

/** Parse the stored cover_palette TEXT into an object, or null when absent/invalid. */
function parsePalette(raw: string | null | undefined): CoverPaletteJson | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && parsed.primary && parsed.secondary && parsed.tertiary
      && ['primary', 'secondary', 'tertiary'].every((k) => {
        const c = parsed[k];
        return c && Number.isInteger(c.r) && Number.isInteger(c.g) && Number.isInteger(c.b);
      })
    ) {
      return parsed as CoverPaletteJson;
    }
  } catch { /* fall through */ }
  return null;
}

function isCoverPaletteShape(value: unknown): value is CoverPaletteJson {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['primary', 'secondary', 'tertiary'].every((k) => {
    const c = p[k] as Record<string, unknown> | undefined;
    return !!c && typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number'
      && c.r >= 0 && c.r <= 255 && c.g >= 0 && c.g <= 255 && c.b >= 0 && c.b <= 255;
  });
}

const songFields = {
  id: schema.songs.id,
  title: schema.songs.title,
  artist: schema.songs.artist,
  lyrics_raw: schema.songs.lyricsRaw,
  lyrics_furigana: schema.songs.lyricsFurigana,
  reading_scheme: schema.songs.readingScheme,
  reading_scheme_confirmed: schema.songs.readingSchemeConfirmed,
  lyrics_synced: schema.songs.lyricsSynced,
  lyrics_translation: schema.songs.lyricsTranslation,
  lyrics_translation_lang: schema.songs.lyricsTranslationLang,
  lyrics_translation_reasoning: schema.songs.lyricsTranslationReasoning,
  lyrics_glossary: schema.songs.lyricsGlossary,
  cover_url: schema.songs.coverUrl,
  cover_palette: schema.songs.coverPalette,
  spotify_track_id: schema.songs.spotifyTrackId,
  spotify_uri: schema.songs.spotifyUri,
  spotify_album: schema.songs.spotifyAlbum,
  spotify_duration_ms: schema.songs.spotifyDurationMs,
  spotify_canonical_title: schema.songs.spotifyCanonicalTitle,
  spotify_canonical_artist: schema.songs.spotifyCanonicalArtist,
  lyrics_source: schema.songs.lyricsSource,
  lyrics_confidence: schema.songs.lyricsConfidence,
  lyrics_needs_review: schema.songs.lyricsNeedsReview,
  lyrics_fetched_at: schema.songs.lyricsFetchedAt,
  created_by: schema.songs.createdBy,
  created_by_name: schema.songs.createdByName,
  is_public: schema.songs.isPublic,
  public_requested: schema.songs.publicRequested,
  created_at: schema.songs.createdAt,
  updated_at: schema.songs.updatedAt,
};

function findSong(id: string) {
  return getDB().select(songFields).from(schema.songs).where(eq(schema.songs.id, id)).get()
    .then((row: { cover_palette: string | null } | undefined) => {
      if (!row) return undefined;
      const { cover_palette, ...rest } = row;
      return { ...rest, cover_palette: parsePalette(cover_palette) } as Song;
    });
}

// GET /api/songs/[id] - get single song
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;
  const song = await findSong(id);
  if (!song || !isSongVisibleToUser(song, user)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  const canEdit = !!user && (user.isAdmin || song.created_by === user.id);
  return NextResponse.json(sanitizeSong(song, canEdit));
}

// PUT /api/songs/[id] - update song
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced, reading_scheme, reading_scheme_confirmed, clear_furigana, clear_translation, clear_reasoning, clear_glossary, cover_palette, source_lyrics } = body;

  if (cover_palette !== undefined && cover_palette !== null && !isCoverPaletteShape(cover_palette)) {
    return NextResponse.json({ error: 'invalid_cover_palette' }, { status: 400 });
  }

  if (reading_scheme !== undefined && reading_scheme !== 'ja-kana' && reading_scheme !== 'yue-jyutping') {
    return NextResponse.json({ error: 'invalid_reading_scheme' }, { status: 400 });
  }
  if (reading_scheme_confirmed !== undefined && typeof reading_scheme_confirmed !== 'boolean') {
    return NextResponse.json({ error: 'invalid_reading_confirmation' }, { status: 400 });
  }

  const existing = await findSong(id);
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Reject LRC whose timestamps are not strictly increasing (including duplicate
  // timestamps). The editor and the playback highlight engine both rely on
  // monotonic ordering; silently storing broken data causes skipped highlights.
  if (lyrics_synced !== undefined && (typeof lyrics_synced !== 'string' || findLrcConflicts(lyrics_synced).length > 0)) {
    return NextResponse.json({ error: 'timestamps_not_ordered' }, { status: 400 });
  }

  // Concurrency guard for the timeline workspace: the client loads the song
  // once and may edit for a long time. If it submits a synced timeline while
  // another tab/session already rewrote the plain lyrics, the submitted LRC
  // would otherwise be reverse-written into lyrics_raw, silently clobbering
  // the newer lyrics text. Refuse instead of overwriting (mirrors the
  // stale-source protection in the furigana/translation save endpoints).
  // Opt-in: the guard only applies when the client submits the `source_lyrics`
  // snapshot it was built from — the timeline workspace always does. Other
  // callers that intentionally replace lyrics (e.g. the song editor's LRC
  // mode) keep their previous behaviour.
  const timelineGuarded = lyrics_synced !== undefined && typeof source_lyrics === 'string';
  if (timelineGuarded) {
    const guard = resolveTimelineSave(existing.lyrics_raw, existing.lyrics_synced, lyrics_synced, source_lyrics);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.error === 'stale_timeline_source' ? 409 : 400 });
    }
  }

  // ---------------------------------------------------------------------------
  // Issue #211: construct the minimal set — only write fields present in the
  // payload, plus derived-invalidation columns whose value depends on the DB's
  // *current* state evaluated via SQL CASE at write time (never a stale
  // request-time snapshot). Two concurrent PUTs touching different fields no
  // longer overwrite each other: a cover-palette-only request writes only
  // `cover_palette` (never resurrects old lyrics/furigana/translation), and a
  // lyrics-only request compares its new text against the live `lyrics_raw`
  // column rather than the snapshot it happened to read.
  // ---------------------------------------------------------------------------
  const set: Record<string, unknown> = {};

  // --- Independent fields: write only when present in the payload ---
  if (title !== undefined) set.title = title;
  if (artist !== undefined) set.artist = artist;
  if (cover_palette !== undefined) {
    set.coverPalette = cover_palette === null ? null : JSON.stringify(cover_palette);
  }
  if (reading_scheme !== undefined) set.readingScheme = reading_scheme;
  if (reading_scheme_confirmed !== undefined) {
    set.readingSchemeConfirmed = Number(reading_scheme_confirmed);
  }

  // --- Lyrics fields ---
  const hasRaw = lyrics_raw !== undefined;
  const hasSynced = lyrics_synced !== undefined;

  // Determine the effective new lyrics_raw (if any). For `lyrics_synced`,
  // resolve whether its text content differs from the current plain lyrics —
  // timestamp-only edits must not rewrite plain lyrics.
  let effectiveNewRaw: string | undefined;
  if (hasRaw) {
    effectiveNewRaw = lyrics_raw;
  } else if (hasSynced) {
    const update = resolveLrcTextUpdate(existing.lyrics_raw, existing.lyrics_synced, lyrics_synced);
    if (update.contentChanged) {
      effectiveNewRaw = update.lyricsRaw;
    }
  }

  if (effectiveNewRaw !== undefined) set.lyricsRaw = effectiveNewRaw;
  if (hasSynced) set.lyricsSynced = lyrics_synced;

  const nextScheme = (reading_scheme ?? existing.reading_scheme) as ReadingScheme;

  // --- Cross-field derived invalidation (SQL CASE against current DB values) ---
  // Each CASE compares the submitted value against the live column at write
  // time. If another request already updated the column, the comparison uses
  // the winner's value — never the stale request-time snapshot.

  // Furigana: cleared when lyrics_raw changes, reading_scheme changes, or
  // explicitly requested via clear_furigana.
  if (clear_furigana === true) {
    set.lyricsFurigana = '[]';
  } else if (effectiveNewRaw !== undefined || reading_scheme !== undefined) {
    const conds: unknown[] = [];
    if (effectiveNewRaw !== undefined) conds.push(sql`${effectiveNewRaw} != lyrics_raw`);
    if (reading_scheme !== undefined) conds.push(sql`${reading_scheme} != reading_scheme`);
    const cond = conds.length === 1 ? conds[0] : or(...conds as Parameters<typeof or>);
    set.lyricsFurigana = sql`CASE WHEN ${cond} THEN '[]' ELSE lyrics_furigana END`;
  }

  // Translation cache + language stamp: invalidated when lyrics content
  // changes or explicitly via clear_translation.
  if (clear_translation === true) {
    set.lyricsTranslation = '[]';
    set.lyricsTranslationLang = null;
  } else if (effectiveNewRaw !== undefined) {
    const cond = sql`${effectiveNewRaw} != lyrics_raw`;
    set.lyricsTranslation = sql`CASE WHEN ${cond} THEN '[]' ELSE lyrics_translation END`;
    set.lyricsTranslationLang = sql`CASE WHEN ${cond} THEN NULL ELSE lyrics_translation_lang END`;
  }

  // Reasoning: wiped when translation is cleared, lyrics content changes, or
  // explicitly via clear_reasoning.
  if (clear_translation === true || clear_reasoning === true) {
    set.lyricsTranslationReasoning = null;
  } else if (effectiveNewRaw !== undefined) {
    set.lyricsTranslationReasoning = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_translation_reasoning END`;
  }

  // Glossary: invalidated when lyrics content changes or explicitly via
  // clear_glossary.
  if (clear_glossary === true) {
    set.lyricsGlossary = null;
  } else if (effectiveNewRaw !== undefined) {
    set.lyricsGlossary = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_glossary END`;
  }

  // reading_scheme_confirmed auto-reset: when lyrics content changes and the
  // active scheme is 'ja-kana', reset the flag (old reading is no longer
  // accurate for the new text). The SQL CASE uses the DB's current scheme,
  // not the request-time snapshot.
  if (reading_scheme_confirmed === undefined && effectiveNewRaw !== undefined) {
    set.readingSchemeConfirmed = sql`CASE
      WHEN ${effectiveNewRaw} != lyrics_raw AND ${nextScheme} = 'ja-kana'
      THEN 0 ELSE reading_scheme_confirmed END`;
  }

  // Metadata when lyrics content actually changes: mark as manual edit, full
  // confidence, needs-review cleared, and drop the fetched-at stamp.
  if (effectiveNewRaw !== undefined) {
    set.lyricsSource = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 'manual' ELSE lyrics_source END`;
    set.lyricsConfidence = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 100 ELSE lyrics_confidence END`;
    set.lyricsNeedsReview = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN 0 ELSE lyrics_needs_review END`;
    set.lyricsFetchedAt = sql`CASE WHEN ${effectiveNewRaw} != lyrics_raw THEN NULL ELSE lyrics_fetched_at END`;
  }

  // Always bump the timestamp on any successful write.
  set.updatedAt = sql`(datetime('now', 'localtime'))`;

  const updatedRow = await db.update(schema.songs)
    .set(set)
    .where(timelineGuarded
      ? and(eq(schema.songs.id, id), eq(schema.songs.lyricsRaw, source_lyrics))
      : eq(schema.songs.id, id))
    .returning({ id: schema.songs.id }).get();

  // Atomicity backstop: the UPDATE above matched `id + lyrics_raw` at execution
  // time, so when it updated no row the source snapshot is already stale —
  // nothing was written and we surface the conflict (mirrors the
  // furigana/translation stale-source pattern). This closes the race between
  // the pre-check and the write that a plain `WHERE id` update cannot see.
  if (timelineGuarded && !updatedRow) {
    return NextResponse.json({ error: 'stale_timeline_source' }, { status: 409 });
  }

  const updated = await findSong(id);
  if (!updated) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(updated, true));
}

// DELETE /api/songs/[id] - delete song
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const existing = await findSong(id);
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await db.delete(schema.songs).where(eq(schema.songs.id, id));
  return NextResponse.json({ success: true });
}
