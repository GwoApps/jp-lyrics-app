import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/collections — list user's collections
export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json([]);
  }

  const collections = await db.prepare(
    'SELECT id, name, created_at FROM collections WHERE user_email = ? ORDER BY name'
  ).all(user.email);

  // Add song count for each collection
  const result = await Promise.all(
    (collections as { id: string; name: string; created_at: string }[]).map(async (c) => {
      const count = await db.prepare(
        'SELECT COUNT(*) as count FROM collection_songs WHERE collection_id = ?'
      ).get(c.id) as { count: number };
      return { ...c, songCount: count.count };
    })
  );

  return NextResponse.json(result);
}

// POST /api/collections — create a new collection
export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const id = uuidv4();
  await db.prepare(
    'INSERT INTO collections (id, user_email, name) VALUES (?, ?, ?)'
  ).run(id, user.email, name.trim());

  return NextResponse.json({ id, name: name.trim() }, { status: 201 });
}
