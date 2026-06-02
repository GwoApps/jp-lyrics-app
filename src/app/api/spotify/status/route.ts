import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const auth = db.prepare('SELECT display_name, updated_at FROM spotify_auth WHERE user_email = ?').get(user.email) as { display_name: string; updated_at: string } | undefined;
  if (!auth || !auth.display_name) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({ connected: true, display_name: auth.display_name });
}

export async function DELETE(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  db.prepare('DELETE FROM spotify_auth WHERE user_email = ?').run(user.email);
  return NextResponse.json({ success: true });
}
