import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const auth = db.prepare('SELECT display_name, updated_at FROM spotify_auth WHERE id = 1').get();
  if (!auth || !auth.display_name) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({ connected: true, display_name: auth.display_name });
}

export async function DELETE() {
  db.prepare('UPDATE spotify_auth SET access_token = \'\', refresh_token = \'\', expires_at = 0, display_name = \'\' WHERE id = 1').run();
  return NextResponse.json({ success: true });
}
