import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOAuthState,
  safeStateEqual,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  OAUTH_STATE_PATH,
} from './oauth-state.ts';

test('generateOAuthState produces high-entropy hex values', async () => {
  const a = await generateOAuthState();
  const b = await generateOAuthState();
  assert.equal(a.length, 64, 'state should be 32 bytes hex-encoded (64 chars)');
  assert.match(a, /^[0-9a-f]{64}$/, 'state should be lowercase hex');
  assert.notEqual(a, b, 'two consecutive states must never collide');
});

test('generateOAuthState is unique across many draws', async () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    seen.add(await generateOAuthState());
  }
  assert.equal(seen.size, 200, 'no collisions in 200 draws');
});

test('safeStateEqual matches identical strings', () => {
  assert.equal(safeStateEqual('abc123', 'abc123'), true);
  assert.equal(safeStateEqual('', ''), true);
});

test('safeStateEqual rejects mismatched values', () => {
  assert.equal(safeStateEqual('abc123', 'abc124'), false);
  assert.equal(safeStateEqual('abc123', 'ABC123'), false);
  assert.equal(safeStateEqual('short', 'much-longer-value'), false);
});

test('safeStateEqual rejects missing / undefined / non-string inputs', () => {
  assert.equal(safeStateEqual(null, 'abc123'), false);
  assert.equal(safeStateEqual(undefined, 'abc123'), false);
  assert.equal(safeStateEqual('abc123', null), false);
  assert.equal(safeStateEqual('abc123', undefined), false);
  assert.equal(safeStateEqual(null, undefined), false);
  assert.equal(safeStateEqual(undefined, undefined), false);
  assert.equal(safeStateEqual('abc123', 'abc123extra'), false);
});

test('safeStateEqual rejects replayed callbacks once the cookie is consumed', () => {
  // After a successful flow the callback clears the state cookie, so the next
  // request carrying the same query state arrives with NO cookie. safeStateEqual
  // must reject it, which is exactly the replay protection the route relies on.
  const replayQueryState = 'state-from-the-first-flow';
  assert.equal(safeStateEqual(replayQueryState, undefined), false);
  assert.equal(safeStateEqual(replayQueryState, ''), false);
});

test('oauth state cookie constants are short-lived and callback-scoped', () => {
  assert.equal(OAUTH_STATE_COOKIE, 'jplrc_oauth_state');
  assert.equal(OAUTH_STATE_MAX_AGE, 5 * 60, 'cookie should expire within 5-10 minutes');
  assert.equal(OAUTH_STATE_PATH, '/api/auth/callback', 'cookie must only travel with the callback');
});
