import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/collections — list user's collections
export async function GET(request: NextRequest) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json([]);
  }

  const collections = await db.all(
    sql`SELECT id, name, created_at FROM collections WHERE user_email = ${user.email} ORDER BY name`
  ) as { id: string; name: string; created_at: string }[];

  // Add song count for each collection
  const result = await Promise.all(
    collections.map(async (c) => {
      const countRow = await db.get(
        sql`SELECT COUNT(*) as count FROM collection_songs WHERE collection_id = ${c.id}`
      ) as { count: number };
      return { ...c, songCount: countRow.count };
    })
  );

  return NextResponse.json(result);
}

// POST /api/collections — create a new collection
export async function POST(request: NextRequest) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const id = uuidv4();
  await db.insert(schema.collections).values({
    id,
    userEmail: user.email,
    name: name.trim(),
  });

  return NextResponse.json({ id, name: name.trim() }, { status: 201 });
}
