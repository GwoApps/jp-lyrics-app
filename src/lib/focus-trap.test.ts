import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFocusTarget, getFocusableElements, computeFocusBounds } from './focus-trap.ts';

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

// --- Modal focus-trap collection helpers (DOM-dependent) ---
// These drive the focus trap: they decide which elements inside a dialog are
// focusable and which are the first/last Tab targets. A minimal fake DOM
// stands in for the real browser so the filtering logic is testable here.

interface FakeElement {
  tagName: string;
  attrs: Record<string, string>;
  hidden: boolean;
  style: { display?: string; visibility?: string; pointerEvents?: string };
  getAttribute(name: string): string | null;
  querySelectorAll(): FakeElement[];
  isFake: true;
}

function makeFakeEl(tagName: string, attrs: Record<string, string> = {}): FakeElement {
  return {
    tagName,
    attrs,
    hidden: false,
    style: {},
    getAttribute(name: string) {
      return name in attrs ? attrs[name] : null;
    },
    querySelectorAll() {
      return [];
    },
    isFake: true,
  };
}

// Cast the fake container to HTMLElement for the helpers; they only touch
// getAttribute/hidden/style/querySelectorAll, all of which the fakes provide.
function asContainer(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}

function asElements(els: FakeElement[]): HTMLElement[] {
  return els as unknown as HTMLElement[];
}

test('getFocusableElements excludes hidden, invisible and negative-tabindex elements', () => {
  const visible = makeFakeEl('button');
  const negativeTab = makeFakeEl('button', { tabindex: '-1' });
  const hiddenAttr = makeFakeEl('button');
  hiddenAttr.hidden = true;
  const displayNone = makeFakeEl('button');
  displayNone.style.display = 'none';
  const visibilityHidden = makeFakeEl('button');
  visibilityHidden.style.visibility = 'hidden';
  const positiveTab = makeFakeEl('a', { href: '#', tabindex: '0' });

  const container = {
    ...makeFakeEl('div'),
    querySelectorAll() {
      return [visible, negativeTab, hiddenAttr, displayNone, visibilityHidden, positiveTab];
    },
  };

  const result = getFocusableElements(asContainer(container));
  assert.deepEqual(result, asElements([visible, positiveTab]));
});

test('computeFocusBounds returns the first and last focusable elements', () => {
  const first = makeFakeEl('button');
  const middle = makeFakeEl('a', { href: '#' });
  const last = makeFakeEl('button');
  const container = {
    ...makeFakeEl('div'),
    querySelectorAll() {
      return [first, middle, last];
    },
  };
  const bounds = computeFocusBounds(asContainer(container));
  assert.ok(bounds);
  assert.equal(bounds.first, first);
  assert.equal(bounds.last, last);
});

test('computeFocusBounds returns null when nothing is focusable', () => {
  const container = {
    ...makeFakeEl('div'),
    querySelectorAll() {
      return [];
    },
  };
  assert.equal(computeFocusBounds(asContainer(container)), null);
});
