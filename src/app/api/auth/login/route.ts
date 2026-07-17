import { NextRequest, NextResponse } from 'next/server';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from '@/lib/spotify';
import {
  isLoginPassphraseRequired,
  loginGateCookie,
  verifyLoginGateToken,
} from '@/lib/login-gate';

export async function GET(request: NextRequest) {
  if (isLoginPassphraseRequired()) {
    const gateToken = request.cookies.get(loginGateCookie.name)?.value;
    if (!await verifyLoginGateToken(gateToken)) {
      const deniedUrl = new URL('/', request.url);
      deniedUrl.searchParams.set('spotify_error', 'passphrase_required');
      return NextResponse.redirect(deniedUrl);
    }
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    show_dialog: 'true',
  });

  const response = NextResponse.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  response.cookies.set(loginGateCookie.name, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: loginGateCookie.path,
  });
  return response;
}
