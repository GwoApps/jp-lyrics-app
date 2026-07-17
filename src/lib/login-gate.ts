const LOGIN_GATE_COOKIE = 'jplrc_login_gate';
const LOGIN_GATE_MAX_AGE = 5 * 60;
const DEFAULT_PASSPHRASE = 'NEVERGONNAGIVEYOUUP';

export const loginGateCookie = {
  name: LOGIN_GATE_COOKIE,
  maxAge: LOGIN_GATE_MAX_AGE,
  path: '/api/auth/login',
} as const;

export function isLoginPassphraseRequired(): boolean {
  const value = process.env.JPLRC_LOGIN_PASSPHRASE_REQUIRED?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function configuredPassphrase(): string {
  return process.env.JPLRC_LOGIN_PASSPHRASE || DEFAULT_PASSPHRASE;
}

function signingSecret(): string {
  return process.env.SESSION_SECRET || process.env.SPOTIFY_CLIENT_SECRET || configuredPassphrase();
}

async function getSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`jplrc-login-gate:${signingSecret()}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((value.length + 3) % 4);
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function verifyLoginPassphrase(candidate: string): boolean {
  if (candidate.length > 256) return false;
  const expected = new TextEncoder().encode(configuredPassphrase());
  const actual = new TextEncoder().encode(candidate);
  const length = Math.max(expected.length, actual.length);
  let difference = expected.length ^ actual.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (expected[index] ?? 0) ^ (actual[index] ?? 0);
  }

  return difference === 0;
}

export async function createLoginGateToken(): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `login.${timestamp}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await getSigningKey(),
    new TextEncoder().encode(payload),
  );
  return `${timestamp}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyLoginGateToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [timestampValue, signatureValue, ...rest] = token.split('.');
  if (!timestampValue || !signatureValue || rest.length > 0) return false;

  const timestamp = Number.parseInt(timestampValue, 10);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || timestamp > now + 30 || now - timestamp > LOGIN_GATE_MAX_AGE) {
    return false;
  }

  try {
    return await crypto.subtle.verify(
      'HMAC',
      await getSigningKey(),
      fromBase64Url(signatureValue),
      new TextEncoder().encode(`login.${timestamp}`),
    );
  } catch {
    return false;
  }
}
