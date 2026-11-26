import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  buildLibraryExport,
  libraryExportFilename,
  type LibraryExportRow,
} from '@/lib/library-export';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Content-Disposition': `attachment; filename="lyrics-backup.json"`,
};

/**
 * GET /api/admin/export — full-library JSON backup (ISSUE #471).
 *
 * Admin only. Every song row is exported with its hand-corrected furigana,
 * translation, synced timeline and glossary; per-user ownership fields
 * (created_by / created_by_name / is_public) are intentionally left out.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const rows = (await db.all(sql`
    SELECT id, title, artist, lyrics_raw, lyrics_furigana, reading_scheme,
           lyrics_synced, lyrics_translation, lyrics_translation_lang,
           lyrics_glossary, lyrics_source, lyrics_confidence, lyrics_fetched_at,
           spotify_track_id, spotify_album, spotify_duration_ms,
           created_at, updated_at
    FROM songs
    ORDER BY created_at ASC, id ASC
  `)) as LibraryExportRow[];

  const payload = buildLibraryExport(rows);
  const headers = {
    ...NO_STORE_HEADERS,
    'Content-Disposition': `attachment; filename="lyrics-backup.json"; filename*=UTF-8''${encodeURIComponent(libraryExportFilename())}`,
  };
  return NextResponse.json(payload, { headers });
}
