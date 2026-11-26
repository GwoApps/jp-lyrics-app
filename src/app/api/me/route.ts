import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { deriveOfflineIdentity, OFFLINE_IDENTITY_HEADER } from '@/lib/offline-identity';

// GET /api/me — current authenticated user info
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  const identity = await deriveOfflineIdentity(user?.id);
  const headers = { [OFFLINE_IDENTITY_HEADER]: identity };
  if (!user) {
    return NextResponse.json({ authenticated: false }, { headers });
  }
  return NextResponse.json({
    authenticated: true,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  }, { headers });
}
