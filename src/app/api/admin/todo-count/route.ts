import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/admin/todo-count — lightweight pending-queue count for the topbar
// badge. Uses exactly the same condition as the mode=queue total, without
// pulling any song rows (kept as a bare COUNT so the global navbar can poll
// it cheaply). Admin only.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const countRow = await db.get(
    sql`SELECT COUNT(*) AS n FROM songs s WHERE s.public_requested = 1 AND s.is_public = 0`,
  ) as { n: number } | undefined;
  return NextResponse.json({ count: Number(countRow?.n ?? 0) });
}
