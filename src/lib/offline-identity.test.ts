import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOfflineIdentity, OFFLINE_IDENTITY_HEADER } from '@/lib/offline-identity';

test('anonymous requests share one non-reversible identity', async () => {
  assert.equal(await deriveOfflineIdentity(undefined), 'anon');
  assert.equal(await deriveOfflineIdentity(''), 'anon');
});

test('a signed-in user gets a stable, hashed identity', async () => {
  const userId = 'spotify:alice@example.test';
  const identity = await deriveOfflineIdentity(userId);
  assert.match(identity, /^u-[A-Za-z0-9_-]+$/);
  assert.equal(await deriveOfflineIdentity(userId), identity);
  assert.notEqual(await deriveOfflineIdentity('spotify:bob@example.test'), identity);
  // The raw user id must never be exposed as the cache key.
  assert.ok(!identity.includes(userId));
  assert.ok(!identity.includes('alice'));
});

test('identity header name is the documented constant', () => {
  assert.equal(OFFLINE_IDENTITY_HEADER, 'X-Offline-Identity');
});
