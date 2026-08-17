import test from 'node:test';
import assert from 'node:assert/strict';
import { CANDIDATE_MAX_AGE, signCandidate, verifyCandidate, contentHash } from './candidate-token.ts';

const TEST_SECRET = 'test-secret-for-candidate-token';

const basePayload = {
  song: 'song-123',
  source: 'lrclib-search',
  confidence: 74,
  plain: 'line one\nline two\nline three',
  synced: '[00:01.00]line one\n[00:02.00]line two',
  updatedAt: '2026-08-14 12:00:00',
};

test('candidate round-trip: sign → verify returns the exact payload', async () => {
  const token = await signCandidate(basePayload, TEST_SECRET);
  const result = await verifyCandidate(token, TEST_SECRET);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.payload, basePayload);
  }
});

test('token is split into exactly 3 fields even when content contains dots', async () => {
  const token = await signCandidate({ ...basePayload, plain: 'a.b.c\nd.e' }, TEST_SECRET);
  assert.equal(token.split('.').length, 3);
});

test('Unicode lyric content round-trips', async () => {
  const payload = { ...basePayload, plain: '日本語の歌詞\n中文歌詞', synced: '' };
  const token = await signCandidate(payload, TEST_SECRET);
  const result = await verifyCandidate(token, TEST_SECRET);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.payload, payload);
});

test('tampered signature is rejected', async () => {
  const token = await signCandidate(basePayload, TEST_SECRET);
  const parts = token.split('.');
  const mid = parts[2].charAt(10);
  const flipped = mid === 'A' ? 'B' : 'A';
  const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, 10)}${flipped}${parts[2].slice(11)}`;
  assert.equal((await verifyCandidate(tampered, TEST_SECRET)).ok, false);
});

test('tampered payload (swapped lyrics) is rejected', async () => {
  const token = await signCandidate(basePayload, TEST_SECRET);
  // Re-sign a modified payload under a different secret won't verify under ours;
  // here we prove that even a syntactically-valid altered payload fails because
  // the signature covers the whole body.
  const parts = token.split('.');
  // The encoded JSON is inside parts[0]; flipping a char invalidates the sig.
  const mid = parts[0].charAt(20);
  const flipped = mid === 'A' ? 'B' : 'A';
  const tampered = `${parts[0].slice(0, 20)}${flipped}${parts[0].slice(21)}.${parts[1]}.${parts[2]}`;
  const result = await verifyCandidate(tampered, TEST_SECRET);
  assert.equal(result.ok, false);
});

test('wrong secret is rejected', async () => {
  const token = await signCandidate(basePayload, TEST_SECRET);
  assert.equal((await verifyCandidate(token, 'another-secret')).ok, false);
});

test('malformed tokens are rejected', async () => {
  assert.equal((await verifyCandidate('', TEST_SECRET)).ok, false);
  assert.equal((await verifyCandidate('only-two-parts', TEST_SECRET)).ok, false);
  assert.equal((await verifyCandidate('a.b.c.d', TEST_SECRET)).ok, false);
});

test('expired token is rejected', async () => {
  // Build a token with a timestamp older than CANDIDATE_MAX_AGE using the
  // internal signer is not possible (it always uses now), so craft one by
  // reproducing the signing with a backdated timestamp.
  const encoded = btoa(JSON.stringify(basePayload));
  const ts = Math.floor(Date.now() / 1000) - CANDIDATE_MAX_AGE - 60;
  const body = `${encoded}.${ts}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expiredToken = `${body}.${sigB64}`;
  assert.equal((await verifyCandidate(expiredToken, TEST_SECRET)).ok, false);
});

test('contentHash is stable and differs across content', async () => {
  const a = await contentHash('same text');
  const b = await contentHash('same text');
  const c = await contentHash('different text');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
});
