import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginHref } from './unsaved-changes.ts';

test('isSameOriginHref distinguishes in-app and external targets', () => {
  const base = 'https://example.com/songs/abc/edit';
  assert.equal(isSameOriginHref('/songs/abc', base), true);
  assert.equal(isSameOriginHref('/songs/abc/edit', base), true);
  assert.equal(isSameOriginHref('https://example.com/foo', base), true);
  assert.equal(isSameOriginHref('https://other.example.com/foo', base), false);
  assert.equal(isSameOriginHref('mailto:a@b.c', base), false);
  assert.equal(isSameOriginHref('javascript:alert(1)', base), false);
});
