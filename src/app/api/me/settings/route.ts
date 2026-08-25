import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getEffectiveTranslationConfig } from '@/lib/translation-settings';
import { getUserSettings, setUserSettings, userTranslationTargetLang, USER_SETTING_KEYS, validateSettingValue, type SettingKey, type UserSettingsMap } from '@/lib/user-settings';

// GET /api/me/settings — current user's personal settings (server-persisted).
// Requires an authenticated session. Unauthenticated → 401.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const settings = await getUserSettings(user.id);
  // The language the next translation request would actually produce:
  // user override wins, otherwise the admin/global default (issue #123).
  const effectiveConfig = await getEffectiveTranslationConfig();
  const effective_target_lang =
    userTranslationTargetLang(settings) ?? effectiveConfig?.targetLang ?? 'zh-CN';
  return NextResponse.json({ settings, effective_target_lang });
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

  // Reject unknown keys so users cannot inject arbitrary settings rows, and
  // validate every value so user overrides can't smuggle arbitrary strings
  // (e.g. a forged `translation_target_lang`) into the translation prompt or
  // bloat the table with oversized values. Invalid values → 400 + error code.
  const patch: UserSettingsMap = {};
  for (const key of Object.keys(body)) {
    if (!(USER_SETTING_KEYS as readonly string[]).includes(key)) continue;
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    const result = validateSettingValue(key as SettingKey, value);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    patch[key as keyof UserSettingsMap] = result.value;
  }

  const settings = await setUserSettings(user.id, patch);
  // Mirror the effective target language so the song page's inline switch can
  // update its display without a second round-trip (issue #123).
  const effectiveConfig = await getEffectiveTranslationConfig();
  const effective_target_lang =
    userTranslationTargetLang(settings) ?? effectiveConfig?.targetLang ?? 'zh-CN';
  return NextResponse.json({ settings, effective_target_lang });
}
