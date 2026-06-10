import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/admin/songs — list all songs with creator info (admin only)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDB();
  const songs = await db.all(
    sql`SELECT s.id, s.title, s.artist, s.created_by, s.created_by_name, s.is_public, s.created_at, s.updated_at
        FROM songs s ORDER BY s.updated_at DESC`
  );
  return NextResponse.json(songs);
}
