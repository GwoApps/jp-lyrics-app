import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../components/ui/dropdown-menu.tsx', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf8');

// Source-policy contracts; real scrollbar geometry and modality are covered by
// the opt-in browser regression in public-files/jplrc/overlay-scroll-lock.
test('native root gutters remain stable for both scrolling and short pages', () => {
  const root = css.match(/html\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(root, /overflow-y:\s*scroll/);
  assert.match(root, /scrollbar-gutter:\s*stable/);
});

test('one shared, native-gutter guarded rule prevents duplicate modal width compensation', () => {
  const rule = css.match(/html body\[data-scroll-locked\]\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(css, /@supports\s*\(scrollbar-gutter:\s*stable\)/);
  // html adds specificity over the later-injected body[data-scroll-locked] rule.
  assert.match(rule, /margin-right:\s*0\s*!important/);
  assert.match(rule, /--removed-body-scroll-bar-size:\s*0px/);
  assert.doesNotMatch(rule, /(?:^|[;\s])(?:overflow|position|pointer-events|transform|width)\s*:/);
  assert.doesNotMatch(rule, /\b(?:5|15|17)px\b/);
});

test('modal locks target the actual root scroller while the stable gutter stays reserved', () => {
  assert.match(css, /html:has\(body\[data-scroll-locked\]\)\s*\{\s*overflow-y:\s*hidden;\s*\}/);
  assert.doesNotMatch(css, /html:has\(body\[data-scroll-locked\]\)\s*\{[^}]*scrollbar-gutter:\s*auto/);
});

test('the layout fix preserves Radix modal menus and Dialog scroll/focus isolation', () => {
  assert.match(menu, /const DropdownMenu = DropdownMenuPrimitive.Root/);
  assert.doesNotMatch(menu, /modal=\{false\}/);
  for (const primitive of ['Root', 'Overlay', 'Content']) {
    assert.ok(dialog.includes(`<DialogPrimitive.${primitive}`));
  }
  assert.doesNotMatch(dialog, /modal=\{false\}|removeScrollBar=\{false\}/);
});
