import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLimit, validateReason, validateExpectedUpdatedAt, hasUnknownFields } from './admin.ts';

test('clampLimit bounds limit to 1..50', () => {
  assert.equal(clampLimit(undefined, 25), 25);
  assert.equal(clampLimit('25'), 25);
  assert.equal(clampLimit('0'), 1);
  assert.equal(clampLimit('100'), 50);
  assert.equal(clampLimit('-5'), 1);
  assert.equal(clampLimit('abc'), 25);
  assert.equal(clampLimit('10', 25), 10);
});

test('validateReason accepts empty / short and rejects long / non-string', () => {
  assert.deepEqual(validateReason(undefined), { reason: '' });
  assert.deepEqual(validateReason(''), { reason: '' });
  assert.deepEqual(validateReason('   '), { reason: '' });
  assert.deepEqual(validateReason('spam'), { reason: 'spam' });
  assert.ok('error' in validateReason('x'.repeat(201)));
  assert.ok('error' in validateReason(42));
  assert.ok('error' in validateReason(null) === false); // null treated as empty
});

test('validateExpectedUpdatedAt only accepts short ISO-like strings', () => {
  assert.equal(validateExpectedUpdatedAt('2026-08-09 12:00:00'), '2026-08-09 12:00:00');
  assert.equal(validateExpectedUpdatedAt('2026-08-09T12:00:00Z'), '2026-08-09T12:00:00Z');
  assert.equal(validateExpectedUpdatedAt(''), null);
  assert.equal(validateExpectedUpdatedAt(42), null);
  assert.equal(validateExpectedUpdatedAt('a'.repeat(65)), null);
  assert.equal(validateExpectedUpdatedAt('not a date; drop table'), null);
});

test('hasUnknownFields rejects any key outside the allowlist', () => {
  const allowed = new Set(['action', 'reason', 'expected_updated_at']);
  assert.equal(hasUnknownFields({ action: 'publish' }, allowed), false);
  assert.equal(hasUnknownFields({ action: 'publish', is_public: 1 }, allowed), true);
  assert.equal(hasUnknownFields({ is_admin: 1 }, new Set(['action'])), true);
  assert.equal(hasUnknownFields({}, allowed), false);
});
