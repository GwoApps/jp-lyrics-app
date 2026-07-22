import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, eq, and } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// POST /api/songs/[id]/favorite — toggle favorite
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Check if already favorited
  const existing = await db.select({ songId: schema.favorites.songId })
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)))
    .get();

  if (existing) {
    // Remove favorite
    await db.delete(schema.favorites)
      .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)));
    return NextResponse.json({ favorited: false });
  } else {
    // Add favorite
    await db.insert(schema.favorites).values({ userEmail: user.email, songId: id });
    return NextResponse.json({ favorited: true });
  }
}

// GET /api/songs/[id]/favorite — check if favorited
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ favorited: false });
  }

  const { id } = await params;
  const existing = await db.select({ songId: schema.favorites.songId })
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)))
    .get();

  return NextResponse.json({ favorited: !!existing });
}
