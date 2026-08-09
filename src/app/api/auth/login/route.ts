import { NextRequest, NextResponse } from 'next/server';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from '@/lib/spotify';
import {
  isLoginPassphraseRequired,
  loginGateCookie,
  verifyLoginGateToken,
} from '@/lib/login-gate';
import {
  generateOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  OAUTH_STATE_PATH,
} from '@/lib/oauth-state';

export async function GET(request: NextRequest) {
  if (isLoginPassphraseRequired()) {
    const gateToken = request.cookies.get(loginGateCookie.name)?.value;
    if (!await verifyLoginGateToken(gateToken)) {
      const deniedUrl = new URL('/', request.url);
      deniedUrl.searchParams.set('spotify_error', 'passphrase_required');
      return NextResponse.redirect(deniedUrl);
    }
  }

  // Bind this authorization request to the initiating browser session: the
  // random state travels to Spotify and must come back unmodified on the
  // callback. A short-lived HttpOnly cookie (path-scoped to the callback) is
  // the only place the expected value is kept.
  const oauthState = await generateOAuthState();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    show_dialog: 'true',
    state: oauthState,
  });

  const response = NextResponse.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  response.cookies.set(OAUTH_STATE_COOKIE, oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE,
    path: OAUTH_STATE_PATH,
  });
  response.cookies.set(loginGateCookie.name, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: loginGateCookie.path,
  });
  return response;
}
