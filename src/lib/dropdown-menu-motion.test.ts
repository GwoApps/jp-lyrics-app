import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static source contracts only: this loader does not render JSX or simulate
// Radix Presence, focus restoration, keyboard interaction, or browser motion.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'components', 'ui', 'dropdown-menu.tsx'), 'utf8');
const css = readFileSync(join(here, '..', 'components', 'ui', 'dropdown-menu.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function blockFor(text: string, header: string): string {
  const start = text.indexOf(`${header} {`);
  assert.notEqual(start, -1, `Missing CSS block: ${header}`);
  const opening = text.indexOf('{', start);
  let depth = 1;
  for (let index = opening + 1; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return text.slice(opening + 1, index);
  }
  assert.fail(`Unclosed CSS block: ${header}`);
}

function declaration(block: string, property: string): string {
  const values = [...block.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)]
    .filter((match) => match[1] === property);
  assert.equal(values.length, 1, `Expected one ${property} declaration`);
  return values[0][2].trim();
}

const normalCss = css.slice(0, css.indexOf('@media'));

describe('dropdown menu motion (static source contracts)', () => {
  test('both content primitives import and share the scoped motion class, refs, and props', () => {
    assert.match(source, /import '\.\/dropdown-menu\.css';/);
    for (const primitive of ['Content', 'SubContent']) {
      const tag = source.match(new RegExp(`<DropdownMenuPrimitive\\.${primitive}\\b[\\s\\S]*?/>`))?.[0];
      assert.ok(tag, `Missing ${primitive} primitive`);
      assert.match(tag, /className=\{`dropdown-menu-motion [^`]*\$\{className\}`\}/);
      assert.match(tag, /ref=\{ref\}/);
      assert.match(tag, /\{\.\.\.props\}/);
    }
    assert.equal((source.match(/dropdown-menu-motion/g) ?? []).length, 2);
    assert.match(source, /sideOffset=\{4\}/);
  });

  test('Radix retains ownership of mounting, open state, and interaction handlers', () => {
    for (const primitive of ['Root', 'Trigger', 'Sub']) {
      assert.match(source, new RegExp(`= DropdownMenuPrimitive\\.${primitive};`));
    }
    assert.doesNotMatch(source, /forceMount|useState|useEffect|setTimeout|onAnimationEnd|onOpenChange|onKeyDown|onCloseAutoFocus/);
  });

  test('normal enter and exit use distinct Presence-observable names and short durations', () => {
    const base = blockFor(normalCss, '.dropdown-menu-motion');
    assert.equal(declaration(base, 'transform-origin'), 'var(--radix-dropdown-menu-content-transform-origin)');
    assert.equal(declaration(base, 'animation-timing-function'), 'cubic-bezier(.22, 1, .36, 1)');
    assert.equal(declaration(base, 'animation-fill-mode'), 'both');
    for (const [state, name, duration] of [
      ['open', 'dropdown-menu-enter', '170ms'],
      ['closed', 'dropdown-menu-exit', '130ms'],
    ]) {
      const rule = blockFor(normalCss, `.dropdown-menu-motion[data-state="${state}"]`);
      assert.equal(declaration(rule, 'animation-name'), name);
      assert.equal(declaration(rule, 'animation-duration'), duration);
    }
    assert.doesNotMatch(css, /transition\s*:|display\s*:|visibility\s*:/);
  });

  test('all collision-resolved Radix sides offset four pixels toward their trigger', () => {
    const base = blockFor(normalCss, '.dropdown-menu-motion');
    assert.equal(declaration(base, '--dropdown-menu-motion-x'), '0px');
    assert.equal(declaration(base, '--dropdown-menu-motion-y'), '0px');
    for (const [side, axis, offset] of [
      ['top', 'y', '4px'],
      ['bottom', 'y', '-4px'],
      ['left', 'x', '4px'],
      ['right', 'x', '-4px'],
    ]) {
      const rule = blockFor(normalCss, `.dropdown-menu-motion[data-side="${side}"]`);
      assert.equal(declaration(rule, `--dropdown-menu-motion-${axis}`), offset);
    }
  });

  test('enter and exit reverse the same opacity/transform-only path without layout animation', () => {
    const enter = blockFor(css, '@keyframes dropdown-menu-enter');
    const exit = blockFor(css, '@keyframes dropdown-menu-exit');
    for (const frames of [enter, exit]) {
      for (const match of frames.matchAll(/([\w-]+)\s*:/g)) {
        assert.ok(['opacity', 'transform'].includes(match[1]), `Unexpected animated property ${match[1]}`);
      }
    }
    const hidden = blockFor(enter, 'from');
    const visible = blockFor(enter, 'to');
    assert.equal(declaration(hidden, 'opacity'), '0');
    assert.equal(declaration(hidden, 'transform'), 'translate(var(--dropdown-menu-motion-x), var(--dropdown-menu-motion-y)) scale(.98)');
    assert.equal(declaration(visible, 'opacity'), '1');
    assert.equal(declaration(visible, 'transform'), 'translate(0, 0) scale(1)');
    assert.equal(blockFor(exit, 'from').trim(), visible.trim());
    assert.equal(blockFor(exit, 'to').trim(), hidden.trim());
  });

  test('reduced motion replaces both animations with brief opacity-only fades', () => {
    const reduced = blockFor(css, '@media (prefers-reduced-motion: reduce)');
    for (const [state, name, duration, from, to] of [
      ['open', 'dropdown-menu-fade-in', '100ms', '0', '1'],
      ['closed', 'dropdown-menu-fade-out', '80ms', '1', '0'],
    ]) {
      const rule = blockFor(reduced, `.dropdown-menu-motion[data-state="${state}"]`);
      assert.equal(declaration(rule, 'animation-name'), name);
      assert.equal(declaration(rule, 'animation-duration'), duration);
      const frames = blockFor(css, `@keyframes ${name}`);
      assert.equal(declaration(blockFor(frames, 'from'), 'opacity'), from);
      assert.equal(declaration(blockFor(frames, 'to'), 'opacity'), to);
      assert.deepEqual([...frames.matchAll(/([\w-]+)\s*:/g)].map((match) => match[1]), ['opacity', 'opacity']);
    }
  });
});
