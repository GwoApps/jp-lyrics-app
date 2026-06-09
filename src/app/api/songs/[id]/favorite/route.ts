import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// POST /api/songs/[id]/favorite — toggle favorite
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Check if already favorited
  const existing = await db.prepare(
    'SELECT 1 FROM favorites WHERE user_email = ? AND song_id = ?'
  ).get(user.email, id);

  if (existing) {
    // Remove favorite
    await db.prepare('DELETE FROM favorites WHERE user_email = ? AND song_id = ?').run(user.email, id);
    return NextResponse.json({ favorited: false });
  } else {
    // Add favorite
    await db.prepare('INSERT INTO favorites (user_email, song_id) VALUES (?, ?)').run(user.email, id);
    return NextResponse.json({ favorited: true });
  }
}

// GET /api/songs/[id]/favorite — check if favorited
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ favorited: false });
  }

  const { id } = await params;
  const existing = await db.prepare(
    'SELECT 1 FROM favorites WHERE user_email = ? AND song_id = ?'
  ).get(user.email, id);

  return NextResponse.json({ favorited: !!existing });
}
