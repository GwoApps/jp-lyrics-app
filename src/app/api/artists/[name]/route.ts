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

export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  // Next already decodes the path segment: never decode again (literal % is valid).
  const { name } = await context.params;
  return handlers.detail(request, name);
}
