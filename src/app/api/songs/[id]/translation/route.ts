import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { and, eq } from 'drizzle-orm';
import { getEffectiveTargetLang } from '@/lib/translation-settings';

// PUT /api/songs/[id]/translation — save manually corrected line-level translations.
// Body: { translations: string[], source_lyrics: string }
// The translations array must be index-aligned to source_lyrics lines (empty lines stay empty).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const body = await request.json();
  const { translations, source_lyrics } = body;

  if (!Array.isArray(translations) || !translations.every((item) => typeof item === 'string')) {
    return NextResponse.json({ error: 'missing_translation' }, { status: 400 });
  }
  if (typeof source_lyrics !== 'string') {
    return NextResponse.json({ error: 'missing_source_lyrics' }, { status: 400 });
  }

  const expected = source_lyrics.split('\n');
  if (translations.length !== expected.length) {
    return NextResponse.json({ error: 'invalid_translation' }, { status: 400 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    lyricsRaw: schema.songs.lyricsRaw,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (source_lyrics !== existing.lyricsRaw) {
    return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
  }

  // Empty source lines must never carry a translation.
  const normalized = expected.map((source, i) => (source.trim() ? translations[i].trim() : ''));

  // Resolve the effective target language the same way the translate pipeline
  // does (admin/global config, then per-user override). A manual correction IS
  // the user confirming the final form of these translations, so its language
  // is by definition the current effective target language. "Whoever last wrote
  // the cache refreshes the language stamp" must hold here too, otherwise an
  // expired stamp marks the user's confirmed work as invalid and triggers a
  // whole-song re-translation (#189 / #93). When no config exists we leave the
  // stamp untouched (nothing to compare against anyway).
  const targetLang = await getEffectiveTargetLang(user.id);

  // Manual corrections replace the AI output — the stored reasoning from the
  // original run no longer matches, so drop it.
  const updated = await db.update(schema.songs).set({
    lyricsTranslation: JSON.stringify(normalized),
    lyricsTranslationReasoning: null,
    ...(targetLang ? { lyricsTranslationLang: targetLang } : {}),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(and(
    eq(schema.songs.id, id),
    eq(schema.songs.lyricsRaw, source_lyrics),
  )).returning({ id: schema.songs.id }).get();

  if (!updated) {
    return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
