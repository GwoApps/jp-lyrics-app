import test from 'node:test';
import assert from 'node:assert/strict';
import { isSongVisibleToUser, songVisibilityWhere } from './song-visibility.ts';

const admin = { id: 'admin@example.com', isAdmin: true };
const owner = { id: 'owner@example.com', isAdmin: false };
const stranger = { id: 'stranger@example.com', isAdmin: false };

test('public songs are visible to everyone, including anonymous users', () => {
  assert.equal(isSongVisibleToUser({ is_public: 1, created_by: 'owner@example.com' }, null), true);
  assert.equal(isSongVisibleToUser({ is_public: 1, created_by: 'owner@example.com' }, stranger), true);
  assert.equal(isSongVisibleToUser({ isPublic: 1, createdBy: 'owner@example.com' }, stranger), true);
});

test('private songs are visible only to their owner', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, owner), true);
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, stranger), false);
  // is_public omitted (default 0 in schema) → still private
  assert.equal(isSongVisibleToUser({ created_by: 'owner@example.com' }, stranger), false);
});

test('admin can read any song', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, admin), true);
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'stranger@example.com' }, admin), true);
});

test('anonymous users cannot read private songs', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, null), false);
});

test('missing or null songs are never visible', () => {
  assert.equal(isSongVisibleToUser(null, admin), false);
  assert.equal(isSongVisibleToUser(undefined, admin), false);
});

// --- SQL predicate parity (ISSUE #346) -------------------------------------
// The list queries in GET /api/songs compose `songVisibilityWhere` into their
// WHERE clause, so the predicate (not each branch) is what decides who sees a
// private song. These tests pin its shape: which columns it compares, which
// params it binds and that the anonymous case binds nothing at all.

/**
 * Structural read-out of a drizzle `SQL` chunk tree: gives back the predicate
 * text (column names + operators, params as `:value`) and the bound params.
 * Reads the chunk tree rather than a driver-rendered string so the assertions
 * stay valid across drizzle versions.
 */
function describePredicate(where: ReturnType<typeof songVisibilityWhere>): { text: string; params: unknown[] } {
  assert.ok(where, 'expected a predicate (undefined = unrestricted)');
  const params: unknown[] = [];
  const render = (chunk: unknown): string => {
    const c = chunk as { value?: unknown; queryChunks?: unknown[]; constructor: { name: string } };
    if (c.constructor.name === 'Param') {
      params.push(c.value);
      return `:${String(c.value)}`;
    }
    if (Array.isArray(c.queryChunks)) return c.queryChunks.map(render).join('');
    if (c.constructor.name === 'SQLiteInteger') return 'is_public';
    if (c.constructor.name === 'SQLiteText') return 'created_by';
    if (Array.isArray(c.value)) return c.value.join('');
    return String(c.value ?? '');
  };
  return { text: render(where), params };
}

test('songVisibilityWhere: anonymous viewers are restricted to is_public = 1', () => {
  const { text, params } = describePredicate(songVisibilityWhere(null));
  assert.equal(text, 'is_public = 1');
  // No `created_by` comparison at all — an empty owner must never match.
  assert.deepEqual(params, []);
});

test('songVisibilityWhere: a logged-in non-admin also sees their own songs', () => {
  const { text, params } = describePredicate(songVisibilityWhere({ email: 'me@example.com', isAdmin: false }));
  assert.equal(text, '(is_public = 1 or created_by = :me@example.com)');
  assert.deepEqual(params, ['me@example.com']);
});

test('songVisibilityWhere: an empty/absent email stays public-only', () => {
  for (const viewer of [null, undefined, {}, { email: '' }, { email: null }]) {
    const { text, params } = describePredicate(songVisibilityWhere(viewer));
    assert.equal(text, 'is_public = 1');
    assert.deepEqual(params, []);
  }
});

test('songVisibilityWhere: admins get no restriction at all', () => {
  assert.equal(songVisibilityWhere({ email: 'admin@example.com', isAdmin: true }), undefined);
});
