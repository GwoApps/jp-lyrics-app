import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/admin/users — list all users (admin only)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDB();
  const users = await db.all(
    sql`SELECT id, display_name, is_admin, is_blocked, blocked_reason, created_at, updated_at FROM users ORDER BY created_at DESC`
  );
  return NextResponse.json(users);
}
