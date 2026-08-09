import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clampLimit, type PageResult } from '@/lib/admin';

/** Opaque cursor: JSON array of ordering-key values, base64url-encoded. */
function encodeCursor(keys: (string | number)[]): string {
  return btoa(JSON.stringify(keys)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
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

function boolParam(value: string | null, fallback = false): boolean {
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return fallback;
}

// GET /api/admin/users — server-side searched / filtered / cursor-paged user
// list with aggregated song counts (admin only).
//
//   q       display_name / id search
//   role    all | admin | user
//   status  all | blocked | active
//   limit   1..50 (default 25)
//   cursor  opaque stable (updated_at, id) cursor
//   total=1 include the filtered total count
//
// Response: { items, next_cursor, total? }
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get('q') ?? '').trim().slice(0, 100);
  const role = searchParams.get('role') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const limit = clampLimit(searchParams.get('limit'), 25);
  const cursor = searchParams.get('cursor');
  const wantTotal = boolParam(searchParams.get('total'));

  const conditions: ReturnType<typeof sql>[] = [];
  if (q) {
    const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(sql`(u.display_name LIKE ${like} ESCAPE '\\' OR u.id LIKE ${like} ESCAPE '\\')`);
  }
  if (role === 'admin') conditions.push(sql`u.is_admin = 1`);
  if (role === 'user') conditions.push(sql`u.is_admin = 0`);
  if (status === 'blocked') conditions.push(sql`u.is_blocked = 1`);
  if (status === 'active') conditions.push(sql`u.is_blocked = 0`);

  // Stable ordering: (updated_at DESC, id DESC). Cursor = [updated_at, id].
  const decoded = decodeCursor(cursor);
  let cursorExpr: ReturnType<typeof sql> | null = null;
  if (decoded && decoded.length === 2 && typeof decoded[0] === 'string' && typeof decoded[1] === 'string') {
    cursorExpr = sql`(u.updated_at < ${decoded[0]} OR (u.updated_at = ${decoded[0]} AND u.id < ${decoded[1]}))`;
  }

  // Single combined WHERE (or none) so the query is always valid SQL.
  const allConditions = [...conditions, ...(cursorExpr ? [cursorExpr] : [])];
  const whereSql = allConditions.length > 0 ? sql`WHERE ${sql.join(allConditions, sql` AND `)}` : sql``;

  const rows = await db.all(
    sql`SELECT u.id, u.display_name, u.is_admin, u.is_blocked, u.blocked_reason,
               u.created_at, u.updated_at,
               (SELECT COUNT(*) FROM songs s WHERE s.created_by = u.id) AS song_count,
               (SELECT COUNT(*) FROM songs s WHERE s.created_by = u.id AND s.is_public = 1) AS public_song_count,
               (SELECT COUNT(*) FROM favorites f WHERE f.user_email = u.id) AS favorite_count,
               (SELECT COUNT(*) FROM collections c WHERE c.user_email = u.id) AS collection_count
        FROM users u ${whereSql}
        ORDER BY u.updated_at DESC, u.id DESC
        LIMIT ${limit + 1}`
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row: Record<string, unknown>) => ({
    id: row.id,
    display_name: row.display_name,
    is_admin: row.is_admin,
    is_blocked: row.is_blocked,
    blocked_reason: row.blocked_reason ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    song_count: Number(row.song_count ?? 0),
    public_song_count: Number(row.public_song_count ?? 0),
    favorite_count: Number(row.favorite_count ?? 0),
    collection_count: Number(row.collection_count ?? 0),
  }));

  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor([String(last.updated_at), String(last.id)]);
  }

  const result: PageResult<Record<string, unknown>> = { items, next_cursor: nextCursor };
  if (wantTotal) {
    const countRow = await db.get(sql`SELECT COUNT(*) AS n FROM users u ${whereSql}`) as { n: number };
    result.total = Number(countRow?.n ?? 0);
  }
  return NextResponse.json(result);
}
