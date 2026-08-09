import test from 'node:test';
import assert from 'node:assert/strict';
import { isSongVisibleToUser } from './song-visibility.ts';

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
