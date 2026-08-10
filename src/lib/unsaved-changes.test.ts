import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginHref, shouldInterceptLinkClick } from './unsaved-changes.ts';

test('isSameOriginHref distinguishes in-app and external targets', () => {
  const base = 'https://example.com/songs/abc/edit';
  assert.equal(isSameOriginHref('/songs/abc', base), true);
  assert.equal(isSameOriginHref('/songs/abc/edit', base), true);
  assert.equal(isSameOriginHref('https://example.com/foo', base), true);
  assert.equal(isSameOriginHref('https://other.example.com/foo', base), false);
  assert.equal(isSameOriginHref('mailto:a@b.c', base), false);
  assert.equal(isSameOriginHref('javascript:alert(1)', base), false);
});

const BASE = 'https://example.com/songs/abc/furigana/edit';

/** Build a LinkClickDecision with sensible defaults for a plain in-app click. */
function decision(overrides: Partial<Parameters<typeof shouldInterceptLinkClick>[0]> = {}) {
  return {
    href: '/songs/abc',
    base: BASE,
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    hasDownload: false,
    targetBlank: false,
    ...overrides,
  };
}

test('shouldInterceptLinkClick intercepts a plain same-origin in-app link', () => {
  assert.equal(shouldInterceptLinkClick(decision()), true);
  assert.equal(shouldInterceptLinkClick(decision({ href: '/songs/abc/edit' })), true);
  assert.equal(shouldInterceptLinkClick(decision({ href: 'https://example.com/songs/abc' })), true);
});

test('shouldInterceptLinkClick ignores non-link clicks', () => {
  assert.equal(shouldInterceptLinkClick(decision({ href: null })), false);
});

test('shouldInterceptLinkClick ignores a link already handled by another handler', () => {
  assert.equal(shouldInterceptLinkClick(decision({ defaultPrevented: true })), false);
});

test('shouldInterceptLinkClick ignores modifier (new-tab) clicks', () => {
  assert.equal(shouldInterceptLinkClick(decision({ metaKey: true })), false);
  assert.equal(shouldInterceptLinkClick(decision({ ctrlKey: true })), false);
  assert.equal(shouldInterceptLinkClick(decision({ shiftKey: true })), false);
  assert.equal(shouldInterceptLinkClick(decision({ altKey: true })), false);
});

test('shouldInterceptLinkClick ignores non-primary mouse buttons', () => {
  assert.equal(shouldInterceptLinkClick(decision({ button: 1 })), false);
  assert.equal(shouldInterceptLinkClick(decision({ button: 2 })), false);
});

test('shouldInterceptLinkClick ignores fragment, download and new-tab anchors', () => {
  assert.equal(shouldInterceptLinkClick(decision({ href: '#section' })), false);
  assert.equal(shouldInterceptLinkClick(decision({ href: '/songs/abc.lrc', hasDownload: true })), false);
  assert.equal(shouldInterceptLinkClick(decision({ href: '/songs/abc', targetBlank: true })), false);
});

test('shouldInterceptLinkClick ignores external or non-web hrefs', () => {
  assert.equal(shouldInterceptLinkClick(decision({ href: 'https://other.example.com/foo' })), false);
  assert.equal(shouldInterceptLinkClick(decision({ href: 'mailto:a@b.c' })), false);
  assert.equal(shouldInterceptLinkClick(decision({ href: 'javascript:alert(1)' })), false);
});
