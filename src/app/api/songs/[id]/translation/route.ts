import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { getEffectiveTargetLang } from '@/lib/translation-settings';
import { mergeLineEditsIntoCache } from '@/lib/translation-cache';
import { parseLineEdits } from '@/lib/translation-line-edits';
import { parseTranslationCache } from '@/lib/translation/parse';
import { isMixedTranslationLang } from '@/lib/translation-cache-lang';

// PUT /api/songs/[id]/translation — save manually corrected line-level translations.
// Body: { changes: [{ index, translation }], source_lyrics: string }
//
// The body carries ONLY the lines the editor actually changed (issue #272).
// A whole-array body used to be the contract, but it rebuilt the cache from the
// editor's entry-time snapshot and only CASed `lyrics_raw` — so any line another
// session wrote meanwhile (AI resume, whole-song run, another tab) was silently
// rolled back to the stale/empty value in that snapshot. The change-set is
// merged into the LATEST stored cache under the same optimistic lock every other
// write path uses (see src/lib/translation-cache.ts), which makes the lost
// update impossible instead of merely detectable.
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
  const { changes, source_lyrics } = body;

  if (typeof source_lyrics !== 'string') {
    return NextResponse.json({ error: 'missing_source_lyrics' }, { status: 400 });
  }

  const expected = source_lyrics.split('\n');
  const parsed = parseLineEdits(changes, expected);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    lyricsRaw: schema.songs.lyricsRaw,
    lyricsTranslation: schema.songs.lyricsTranslation,
    lyricsTranslationLang: schema.songs.lyricsTranslationLang,
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

  // Nothing changed in this session (the editor had already saved) — do not
  // write, just hand back the current cache so the client stays in sync.
  if (parsed.edits.length === 0) {
    const current = parseTranslationCache(existing.lyricsTranslation, expected.length);
    return NextResponse.json({ ok: true, translations: current });
  }

  // Resolve the effective target language the same way the translate pipeline
  // does (admin/global config, then per-user override). A manual correction IS
  // the user confirming the final form of these translations, so its language
  // is by definition the current effective target language. "Whoever last wrote
  // the cache refreshes the language stamp" must hold here too, otherwise an
  // expired stamp marks the user's confirmed work as invalid and triggers a
  // whole-song re-translation (#189 / #93). When no config exists we leave the
  // stamp untouched (nothing to compare against anyway).
  //
  // That refresh is only truthful while the whole cache is in `targetLang`
  // (issue #394). The editor loads whatever is stored — including a cache
  // written for a *previous* target language — and sends only the lines it
  // changed, so untouched lines of the old language survive the merge.
  // Relabelling them as `targetLang` would make the mismatch banner disappear,
  // count them as coverage and let the whole-song cache short-circuit serve
  // them as current. `mergeLineEditsIntoCache` therefore decides the stamp from
  // the merged cache itself: preserved while old-language lines remain.
  const targetLang = await getEffectiveTargetLang(user.id);
  const storedLang = existing.lyricsTranslationLang ?? null;

  const result = await mergeLineEditsIntoCache(db, {
    id,
    sourceLyrics: source_lyrics,
    totalLines: expected.length,
    edits: parsed.edits,
    ...(targetLang ? { lang: targetLang } : {}),
    // Manual corrections replace the AI output for the lines they touch — the
    // reasoning stored from the original run no longer matches what is shown,
    // so drop it (unchanged from the previous contract).
    patch: { lyricsTranslationReasoning: null },
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
    }
    if (result.reason === 'stale_source') {
      // The lyrics moved on while the user was proofreading.
      return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
    }
    // Retries exhausted under pathological write contention — retryable, and
    // reported as such instead of pretending the save succeeded.
    return NextResponse.json({ error: 'write_contention' }, { status: 409 });
  }

  // Did this save leave the cache mixed by language? The stamp the merge
  // committed is authoritative (`undefined` = preserved), so the flag covers
  // both "the old stamp was kept" and a pre-existing mismatch this save did not
  // fix. OPTIONAL response field: existing clients ignore it, and it changes no
  // status/signature for them.
  const effectiveLang = 'lang' in result ? result.lang : storedLang;
  const mixedTranslationLang = isMixedTranslationLang(effectiveLang, targetLang);

  // The merged cache (not the submitted change-set) is authoritative: it may
  // contain lines another session wrote while the editor was open, and the
  // client adopts them so the user sees what is actually stored.
  return NextResponse.json({
    ok: true,
    translations: result.cache,
    ...(mixedTranslationLang ? { mixed_translation_lang: true } : {}),
  });
}
