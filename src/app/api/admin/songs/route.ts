import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { parseFuriganaLines, parseTranslations } from '@/lib/lyrics-export';
import { getLrcTextLines } from '@/lib/lrc';
import { clampLimit, type PageResult } from '@/lib/admin';

/**
 * Compute lightweight quality-summary fields for a song without shipping the
 * full lyrics body into the admin list. The full content is fetched on demand
 * by the detail panel via GET /api/songs/[id].
 */
function withLyricsSummary(
  row: Record<string, unknown>,
  lyricsRaw: string,
  lyricsSynced: string,
  lyricsFurigana: string,
  lyricsTranslation: string,
): Record<string, unknown> {
  const lyricLines = lyricsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const hasFurigana = parseFuriganaLines(lyricsFurigana)
    .some((line) => line.segments.some((seg) => seg.reading && seg.text !== seg.reading));
  const hasTranslation = parseTranslations(lyricsTranslation).some((line) => line.trim().length > 0);

  // Destructure to strip the full lyrics columns from the list payload while
  // keeping them available for summary computation.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lyrics_raw, lyrics_synced, lyrics_furigana, lyrics_translation, ...rest } = row;
  return {
    ...rest,
    lyric_line_count: lyricLines.length,
    has_synced_timeline: getLrcTextLines(lyricsSynced).length > 0,
    has_furigana: hasFurigana,
    has_translation: hasTranslation,
    lyrics_preview: lyricLines.slice(0, 6).join('\n'),
  };
}

function boolParam(value: string | null, fallback = false): boolean {
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return fallback;
}

const SONG_SORTS = ['updated', 'created', 'confidence'] as const;
type SongSort = (typeof SONG_SORTS)[number];

function parseSongParams(searchParams: URLSearchParams) {
  const q = (searchParams.get('q') ?? '').trim().slice(0, 100);
  const status = searchParams.get('status') ?? 'all'; // all | public | private
  const review = searchParams.get('review') ?? 'all'; // all | needs
  const pending = searchParams.get('pending') ?? 'all'; // all | pending
  const source = (searchParams.get('source') ?? '').trim().slice(0, 60);
  const mode = searchParams.get('mode') ?? 'content'; // content | queue
  const rawSort = searchParams.get('sort') ?? 'updated';
  const sort: SongSort = (SONG_SORTS as readonly string[]).includes(rawSort) ? (rawSort as SongSort) : 'updated';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const limit = clampLimit(searchParams.get('limit'), 25);
  const cursor = searchParams.get('cursor');
  const wantTotal = boolParam(searchParams.get('total'));
  return { q, status, review, pending, source, mode, sort, order, limit, cursor, wantTotal };
}

/** Opaque cursor: JSON array of ordering-key values, base64url-encoded. */
function encodeCursor(keys: (string | number)[]): string {
  const raw = JSON.stringify(keys);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeCursor(cursor: string | null): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// GET /api/admin/songs — server-side searched / filtered / sorted / cursor-paged
// song list with lightweight quality summaries (admin only). Full lyrics are
// intentionally never included; the detail panel fetches them on demand.
//
//   mode=queue    pending public-approval queue (priority-ordered: needs_review
//                 first, then oldest request first)
//   mode=content  full library with q/status/review/pending/source/sort filters
//
// Response: { items, next_cursor, total? } with a stable ordering-key cursor.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const { q, status, review, pending, source, mode, sort, order, limit, cursor, wantTotal } =
    parseSongParams(request.nextUrl.searchParams);

  const conditions: ReturnType<typeof sql>[] = [];
  if (q) {
    const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(
      sql`(s.title LIKE ${like} ESCAPE '\\' OR s.artist LIKE ${like} ESCAPE '\\'
           OR s.created_by_name LIKE ${like} ESCAPE '\\' OR s.created_by LIKE ${like} ESCAPE '\\')`
    );
  }
  if (mode === 'queue') {
    conditions.push(sql`s.public_requested = 1 AND s.is_public = 0`);
  } else {
    if (status === 'public') conditions.push(sql`s.is_public = 1`);
    if (status === 'private') conditions.push(sql`s.is_public = 0`);
    if (pending === 'pending') conditions.push(sql`s.public_requested = 1 AND s.is_public = 0`);
  }
  if (review === 'needs') conditions.push(sql`s.lyrics_needs_review = 1`);
  if (source) conditions.push(sql`s.lyrics_source = ${source}`);

  // Deterministic ordering key per mode/sort. The cursor always encodes the
  // last row's ordering-key values, so the continuation predicate is simply
  // "key > last" / "key < last" compared lexicographically column-by-column.
  type KeyCol = { name: string; asc: boolean };
  const keyCols: KeyCol[] = mode === 'queue'
    ? [
        { name: 's.lyrics_needs_review', asc: false },
        { name: 's.created_at', asc: true },
        { name: 's.id', asc: true },
      ]
    : sort === 'created'
      ? [
          { name: 's.created_at', asc: order === 'asc' },
          { name: 's.id', asc: order === 'asc' },
        ]
      : sort === 'confidence'
        ? [
            { name: 's.lyrics_confidence', asc: true },
            { name: 's.updated_at', asc: false },
            { name: 's.id', asc: false },
          ]
        : [
            { name: 's.updated_at', asc: order === 'asc' },
            { name: 's.id', asc: order === 'asc' },
          ];

  const orderParts = keyCols.map((c) => sql`${sql.raw(c.name)} ${sql.raw(c.asc ? 'ASC' : 'DESC')}`);
  const orderSql = sql`ORDER BY ${sql.join(orderParts, sql`, `)}`;

  // Cursor continuation: compare each key column against the decoded last-row
  // values with lexicographic OR-chains ((k1 > v1) OR (k1 = v1 AND k2 > v2) ...).
  // The expression is emitted WITHOUT the leading AND so it can be joined into
  // a single WHERE clause alongside the regular filters.
  const decoded = decodeCursor(cursor);
  let cursorExpr: ReturnType<typeof sql> | null = null;
  if (decoded && decoded.length === keyCols.length) {
    const clauses: ReturnType<typeof sql>[] = [];
    for (let i = 0; i < keyCols.length; i++) {
      const col = keyCols[i];
      const comp = col.asc ? sql`>` : sql`<`;
      const prefix = clauses.length === 0
        ? sql``
        : sql`${sql.join(
            keyCols.slice(0, i).map((c, j) => sql`${sql.raw(c.name)} = ${decoded[j] as string | number}`),
            sql` AND `,
          )} AND `;
      clauses.push(sql`(${prefix}${sql.raw(col.name)} ${comp} ${decoded[i] as string | number})`);
    }
    cursorExpr = sql`(${sql.join(clauses, sql` OR `)})`;
  }

  // Single combined WHERE (or none) so the query is always valid SQL.
  const allConditions = [...conditions, ...(cursorExpr ? [cursorExpr] : [])];
  const whereSql = allConditions.length > 0 ? sql`WHERE ${sql.join(allConditions, sql` AND `)}` : sql``;

  const rows = await db.all(
    sql`SELECT s.id, s.title, s.artist, s.created_by, s.created_by_name, s.is_public,
               s.public_requested, s.created_at, s.updated_at, s.lyrics_needs_review,
               s.lyrics_confidence, s.lyrics_source,
               s.lyrics_raw, s.lyrics_synced, s.lyrics_furigana, s.lyrics_translation
        FROM songs s ${whereSql} ${orderSql} LIMIT ${limit + 1}`
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((song: Record<string, unknown>) =>
    withLyricsSummary(
      song,
      String(song.lyrics_raw ?? ''),
      String(song.lyrics_synced ?? ''),
      String(song.lyrics_furigana ?? ''),
      String(song.lyrics_translation ?? ''),
    )
  );

  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1] as Record<string, unknown>;
    const keys = keyCols.map((c) => {
      const col = c.name.slice(2); // strip "s."
      const val = last[col];
      return typeof val === 'number' ? val : String(val ?? '');
    });
    nextCursor = encodeCursor(keys);
  }

  const result: PageResult<Record<string, unknown>> = { items, next_cursor: nextCursor };
  if (wantTotal) {
    const countRow = await db.get(sql`SELECT COUNT(*) AS n FROM songs s ${whereSql}`) as { n: number };
    result.total = Number(countRow?.n ?? 0);
  }
  return NextResponse.json(result);
}
