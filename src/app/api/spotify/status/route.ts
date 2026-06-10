import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const auth = await db.select({
    displayName: schema.spotifyAuth.displayName,
    updatedAt: schema.spotifyAuth.updatedAt,
  }).from(schema.spotifyAuth).where(sql`user_email = ${user.email}`).get();

  if (!auth || !auth.displayName) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({ connected: true, display_name: auth.displayName });
}

export async function DELETE(request: NextRequest) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await db.delete(schema.spotifyAuth).where(sql`user_email = ${user.email}`);
  return NextResponse.json({ success: true });
}
