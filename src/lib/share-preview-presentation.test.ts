import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createSharePreviewPresentation } from './share-preview-presentation.ts';

// Minimal DOM ports for deterministic unit tests, not browser/E2E coverage.
class Frame extends EventTarget {
  width = 1200;
  height = 630;
  className = '';
  classes = new Set<string>();
  attributes = new Map<string, string>();
  parent: Layers | null = null;
  classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
  };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  remove() {
    if (!this.parent) return;
    const parent = this.parent;
    parent.children = parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  asCanvas() { return this as unknown as HTMLCanvasElement; }
}

class Layers {
  children: Frame[] = [];
  maxChildren = 0;
  append(frame: Frame) {
    frame.parent = this;
    this.children.push(frame);
    this.maxChildren = Math.max(this.maxChildren, this.children.length);
  }
  replaceChildren() {
    for (const frame of this.children) frame.parent = null;
    this.children = [];
  }
}

function setup(t: TestContext) {
  const root = { style: { aspectRatio: '' } };
  const layers = new Layers();
  const animation = { animationName: 'share-card-preview-enter', animationDuration: '0.22s' };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => animation,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'getComputedStyle', original);
    else Reflect.deleteProperty(globalThis, 'getComputedStyle');
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const presentation = createSharePreviewPresentation(
    root as unknown as HTMLDivElement,
    layers as unknown as HTMLDivElement,
  );
  t.after(() => presentation.dispose());
  return { root, layers, animation, presentation };
}

test('first frame is shown without a fade and sets only CSS aspect ratio', (t) => {
  const { root, layers, presentation } = setup(t);
  const first = new Frame();
  first.width = 630;
  first.height = 1200;
  presentation.present(first.asCanvas());
  assert.deepEqual(layers.children, [first]);
  assert.equal(root.style.aspectRatio, '630 / 1200');
  assert.equal(first.width, 630);
  assert.equal(first.height, 1200);
  assert.equal(first.attributes.get('aria-hidden'), 'true');
  assert.equal(first.classes.size, 0);
});

test('rapid fade-time commits retain at most two DOM layers and only the newest pending frame', (t) => {
  const { root, layers, presentation } = setup(t);
  const first = new Frame();
  const entering = new Frame();
  presentation.present(first.asCanvas());
  presentation.present(entering.asCanvas());
  let latest = first;
  for (let i = 0; i < 1000; i += 1) {
    latest = new Frame();
    latest.width = 630;
    latest.height = 1200;
    presentation.present(latest.asCanvas());
  }
  assert.deepEqual(layers.children, [first, entering]);
  assert.equal(root.style.aspectRatio, '1200 / 630', 'dimensions track displayed, not queued frames');
  entering.dispatchEvent(new Event('animationend'));
  assert.deepEqual(layers.children, [entering, latest]);
  assert.equal(root.style.aspectRatio, '630 / 1200');
  assert.equal(latest.classes.has('share-card-preview__frame--entering'), true);
  latest.dispatchEvent(new Event('animationend'));
  assert.deepEqual(layers.children, [latest]);
  assert.equal(layers.maxChildren, 2);
  assert.equal(latest.classes.size, 0);
});

test('computed duration timeout drains pending frames if animationend never arrives', (t) => {
  const { layers, animation, presentation } = setup(t);
  const first = new Frame();
  const entering = new Frame();
  const latest = new Frame();
  presentation.present(first.asCanvas());
  presentation.present(entering.asCanvas());
  presentation.present(latest.asCanvas());
  t.mock.timers.tick(220 + 32);
  assert.deepEqual(layers.children, [entering, latest]);
  animation.animationDuration = '220ms';
  t.mock.timers.tick(220 + 32);
  assert.deepEqual(layers.children, [latest]);
  presentation.present(new Frame().asCanvas());
  t.mock.timers.tick(220 + 32);
  assert.equal(layers.children.length, 1, 'millisecond and second duration syntax both complete');
});

test('disabled animations skip fades and retain just the latest completed frame', (t) => {
  const { layers, animation, presentation } = setup(t);
  animation.animationName = 'none';
  animation.animationDuration = '0s';
  for (let i = 0; i < 100; i += 1) presentation.present(new Frame().asCanvas());
  assert.equal(layers.children.length, 1);
  assert.equal(layers.children[0].classes.size, 0);
  t.mock.timers.tick(10_000);
  assert.equal(layers.children.length, 1);
});

test('animation cancellation releases old layers and applies the latest queued frame', (t) => {
  const { layers, animation, presentation } = setup(t);
  const first = new Frame();
  const entering = new Frame();
  const latest = new Frame();
  presentation.present(first.asCanvas());
  presentation.present(entering.asCanvas());
  presentation.present(latest.asCanvas());
  animation.animationName = 'none';
  animation.animationDuration = '0s';
  entering.dispatchEvent(new Event('animationcancel'));
  assert.deepEqual(layers.children, [latest]);
  t.mock.timers.tick(10_000);
  assert.deepEqual(layers.children, [latest]);
});

test('dispose removes both DOM frames, pending work, listeners and timeout callbacks', (t) => {
  const { layers, root, presentation } = setup(t);
  const first = new Frame();
  const entering = new Frame();
  const pending = new Frame();
  pending.width = 630;
  presentation.present(first.asCanvas());
  presentation.present(entering.asCanvas());
  presentation.present(pending.asCanvas());
  const ratio = root.style.aspectRatio;
  presentation.dispose();
  entering.dispatchEvent(new Event('animationend'));
  entering.dispatchEvent(new Event('animationcancel'));
  t.mock.timers.tick(10_000);
  presentation.present(new Frame().asCanvas());
  assert.deepEqual(layers.children, []);
  assert.equal(root.style.aspectRatio, ratio);
  assert.equal(first.parent, null);
  assert.equal(entering.parent, null);
  assert.equal(pending.parent, null);
});
