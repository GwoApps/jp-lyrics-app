import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_MAX_AGE, signSession, verifySession } from './session-token.ts';

const TEST_SECRET = 'test-secret-for-session-token';

test('session round-trip: dotted email survives sign → verify', async () => {
  const userId = 'john.doe@example.com';
  const token = await signSession(userId, TEST_SECRET);
  assert.equal(await verifySession(token, TEST_SECRET), userId);
});

test('session round-trip: @-free but dotted id survives', async () => {
  const userId = 'spotify:abc.123.def';
  const token = await signSession(userId, TEST_SECRET);
  assert.equal(await verifySession(token, TEST_SECRET), userId);
});

test('session round-trip: Unicode user id survives', async () => {
  const userId = '烧饼.さん@example.com';
  const token = await signSession(userId, TEST_SECRET);
  assert.equal(await verifySession(token, TEST_SECRET), userId);
});

test('session round-trip: spotify account id survives', async () => {
  const userId = 'spotify:31k6v5abcDEF0123';
  const token = await signSession(userId, TEST_SECRET);
  assert.equal(await verifySession(token, TEST_SECRET), userId);
});

test('token is split into exactly 3 fields even for dotted email', async () => {
  const token = await signSession('john.doe@example.com', TEST_SECRET);
  // base64url(userId) contains no dots — this is the exact regression the issue reported.
  assert.equal(token.split('.').length, 3);
});

test('legacy dot-free token (plain userId.ts.sig) still verifies', async () => {
  const userId = 'spotify:legacyuser';
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${ts}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const legacyToken = `${userId}.${ts}.${sigB64}`;
  assert.equal(await verifySession(legacyToken, TEST_SECRET), userId);
});

test('tampered signature is rejected', async () => {
  const token = await signSession('john.doe@example.com', TEST_SECRET);
  const parts = token.split('.');
  // Flip a character in the middle of the signature — the last character can
  // encode unused padding bits, so flipping it may not change the decoded bytes.
  const mid = parts[2].charAt(10);
  const flipped = mid === 'A' ? 'B' : 'A';
  const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, 10)}${flipped}${parts[2].slice(11)}`;
  assert.equal(await verifySession(tampered, TEST_SECRET), null);
});

test('tampered user id is rejected', async () => {
  const token = await signSession('john.doe@example.com', TEST_SECRET);
  const parts = token.split('.');
  // Flip a character in the middle of the encoded id — the last char can encode
  // unused padding bits, so flipping it may not change the decoded id.
  const mid = parts[0].charAt(10);
  const flipped = mid === 'A' ? 'B' : 'A';
  const tampered = `${parts[0].slice(0, 10)}${flipped}${parts[0].slice(11)}.${parts[1]}.${parts[2]}`;
  assert.equal(await verifySession(tampered, TEST_SECRET), null);
});

test('wrong secret is rejected', async () => {
  const token = await signSession('john.doe@example.com', TEST_SECRET);
  assert.equal(await verifySession(token, 'another-secret'), null);
});

test('malformed tokens are rejected', async () => {
  assert.equal(await verifySession('', TEST_SECRET), null);
  assert.equal(await verifySession('only-two-parts', TEST_SECRET), null);
  assert.equal(await verifySession('a.b.c.d', TEST_SECRET), null); // not enough fields after parse
  assert.equal(await verifySession('a.not-a-number.sig', TEST_SECRET), null);
});

test('expired token is rejected', async () => {
  const userId = 'john.doe@example.com';
  // Build a token with a timestamp older than SESSION_MAX_AGE.
  const ts = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE - 60;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();
  const encUserId = btoa(String.fromCharCode(...encoder.encode(userId)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = `${encUserId}.${ts}`;
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expiredToken = `${payload}.${sigB64}`;
  assert.equal(await verifySession(expiredToken, TEST_SECRET), null);
});
