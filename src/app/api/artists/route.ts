import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { createArtistApiHandlers } from '@/lib/artist-library';
import { getArtistProfile } from '@/lib/artist-metadata';

export const dynamic = 'force-dynamic';

const handlers = createArtistApiHandlers({
  getDB,
  getUser: getAuthUser,
  getProfile: (name, songs, viewer) => getArtistProfile(name, songs, viewer?.email),
});

export async function GET(request: NextRequest) {
  return handlers.list(request);
}
