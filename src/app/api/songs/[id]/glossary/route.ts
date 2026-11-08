import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { extractLyricsGlossary, getTranslationConfig } from '@/lib/translation';
import { getStoredTranslationConfig, resolveTranslationConfig } from '@/lib/translation-settings';
import { writeSongField } from '@/lib/translation-cache';
import {
  GLOSSARY_FAILED_MARKER,
  manualGlossaryEntries,
  mergeGlossaryEntries,
  serializeLyricsGlossary,
} from '@/lib/lyrics-glossary';

/**
 * POST /api/songs/[id]/glossary — re-run terminology extraction (issue #341).
 *
 * Before this route the only way to get a fresh extraction was to clear the
 * table and hope the next translation produced something different — the
 * auto-extracted result was otherwise write-once and the user had no explicit
 * retry. This is the "my terms are wrong, try again" action.
 *
 * Responses:
 *   200 { ok: true, glossary, failed } — extraction ran. `glossary` is the new
 *        table; `failed: true` means the model call itself failed, in which
 *        case the column holds the 'null' retry marker rather than '[]'.
 *
 * Hand-pinned terms are never replaced by the model's output: the extracted
 * entries are merged around them (same rule the translate path applies), so
 * "re-extract" cannot silently undo a correction the user typed.
 *
 *   401 / 403 / 404 as usual, 409 when the lyrics changed mid-flight,
 *   400 when the song has no lyrics, 503 when no provider is configured.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    title: schema.songs.title,
    artist: schema.songs.artist,
    lyricsRaw: schema.songs.lyricsRaw,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const stored = await getStoredTranslationConfig(db);
  const config = resolveTranslationConfig(stored, getTranslationConfig());
  if (!config) {
    return NextResponse.json({ error: 'translation_not_configured' }, { status: 503 });
  }

  const lines: string[] = existing.lyricsRaw.split('\n');
  if (!lines.some((line) => line.trim())) {
    return NextResponse.json({ error: 'empty_lyrics' }, { status: 400 });
  }

  const storedRow = await db.select({ lyricsGlossary: schema.songs.lyricsGlossary })
    .from(schema.songs).where(eq(schema.songs.id, id)).get();
  const manual = manualGlossaryEntries(storedRow?.lyricsGlossary ?? null);

  const extracted = await extractLyricsGlossary(
    existing.title, existing.artist, lines, config, { signal: request.signal },
  );

  const merged = extracted === null ? manual : mergeGlossaryEntries(manual, extracted);
  // With hand-pinned terms a failure needs no marker: their presence alone
  // keeps the state retryable, and the model must not be able to erase them.
  const value = extracted === null && merged.length === 0
    ? GLOSSARY_FAILED_MARKER
    : serializeLyricsGlossary(merged);

  const write = await writeSongField(db, {
    id,
    sourceLyrics: existing.lyricsRaw,
    patch: { lyricsGlossary: value },
  });
  if (!write.ok) {
    // The lyrics changed while the model ran — this extraction describes text
    // the user is no longer looking at. Never pin it.
    return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, glossary: merged, failed: extracted === null });
}
