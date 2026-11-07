import type { NextRequest } from 'next/server';
import { artistProfileAdminHandlers } from '@/lib/artist-profile-server';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  return artistProfileAdminHandlers.lookup(request);
}
