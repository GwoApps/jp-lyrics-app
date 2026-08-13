import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFocusTarget } from './focus-trap.ts';

// Plain objects stand in for focusable elements; nextFocusTarget only relies
// on reference identity and ordering, so it is fully testable without a DOM.
const a = { id: 'a' };
const b = { id: 'b' };
const c = { id: 'c' };

test('nextFocusTarget moves forward and wraps at the end', () => {
  const els = [a, b, c];
  assert.equal(nextFocusTarget(els, a, false), b);
  assert.equal(nextFocusTarget(els, b, false), c);
  assert.equal(nextFocusTarget(els, c, false), a); // wrap last -> first
});

test('nextFocusTarget moves backward and wraps at the start', () => {
  const els = [a, b, c];
  assert.equal(nextFocusTarget(els, c, true), b);
  assert.equal(nextFocusTarget(els, b, true), a);
  assert.equal(nextFocusTarget(els, a, true), c); // wrap first -> last
});

test('nextFocusTarget with a single element keeps returning it', () => {
  const els = [a];
  assert.equal(nextFocusTarget(els, a, false), a);
  assert.equal(nextFocusTarget(els, a, true), a);
});

test('nextFocusTarget jumps to a natural end when current is not in the list', () => {
  const els = [a, b, c];
  const outside = { id: 'outside' };
  assert.equal(nextFocusTarget(els, outside, false), a);
  assert.equal(nextFocusTarget(els, outside, true), c);
  assert.equal(nextFocusTarget(els, null, false), a);
  assert.equal(nextFocusTarget(els, null, true), c);
});

test('nextFocusTarget returns null for an empty list', () => {
  assert.equal(nextFocusTarget([], a, false), null);
  assert.equal(nextFocusTarget([], a, true), null);
  assert.equal(nextFocusTarget([], null, false), null);
});
