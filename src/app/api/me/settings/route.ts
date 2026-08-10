import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserSettings, setUserSettings, USER_SETTING_KEYS, type UserSettingsMap } from '@/lib/user-settings';

// GET /api/me/settings — current user's personal settings (server-persisted).
// Requires an authenticated session. Unauthenticated → 401.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const settings = await getUserSettings(user.id);
  return NextResponse.json({ settings });
}

// PUT /api/me/settings — save personal settings (whitelisted keys only).
// Only the authenticated user can read/write their own rows.
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  let body: UserSettingsMap = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Reject unknown keys so users cannot inject arbitrary settings rows.
  const patch: UserSettingsMap = {};
  for (const key of Object.keys(body)) {
    if ((USER_SETTING_KEYS as readonly string[]).includes(key)) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string') patch[key as keyof UserSettingsMap] = value;
    }
  }

  const settings = await setUserSettings(user.id, patch);
  return NextResponse.json({ settings });
}
