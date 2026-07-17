import { NextRequest, NextResponse } from 'next/server';
import {
  createLoginGateToken,
  isLoginPassphraseRequired,
  loginGateCookie,
  verifyLoginPassphrase,
} from '@/lib/login-gate';

export async function GET() {
  return NextResponse.json(
    { required: isLoginPassphraseRequired() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  if (!isLoginPassphraseRequired()) {
    return NextResponse.json({ ok: true });
  }

  let passphrase = '';
  try {
    const body = await request.json() as { passphrase?: unknown };
    if (typeof body.passphrase === 'string') passphrase = body.passphrase;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (!verifyLoginPassphrase(passphrase)) {
    return NextResponse.json({ error: 'passphrase_invalid' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(loginGateCookie.name, await createLoginGateToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: loginGateCookie.maxAge,
    path: loginGateCookie.path,
  });
  return response;
}
