import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dialog = source('components/ui/dialog.tsx');
const css = source('components/ui/dialog.css');

// Static lifecycle/style contracts. Real browser/perceptual checks are opt-in.
test('shared modal delegates portal, presence, semantics and focus scope to Radix', () => {
  assert.match(dialog, /@radix-ui\/react-dialog/);
  for (const name of ['Root', 'Portal', 'Overlay', 'Content', 'Title']) {
    assert.ok(dialog.includes(`<DialogPrimitive.${name}`));
  }
  assert.match(dialog, /<DialogPrimitive.Root open=\{open\}/);
  assert.doesNotMatch(dialog, /if \(!open\) return null|forceMount/);
  assert.match(dialog, /aria-describedby=\{props\['aria-describedby'\]\}/);
});

test('closing retains its last open target, then releases captured form data after exit', () => {
  assert.match(dialog, /const visible = open \? \{ children, title \} : snapshot/);
  assert.match(dialog, /if \(open && \(snapshot.children !== children/);
  assert.match(dialog, /onCloseAutoFocus=\{\(event\) => \{\s*if \(!open\) setSnapshot\(\{ children: null, title: null \}\)/);
  assert.doesNotMatch(dialog, /setTimeout/);
});

test('controlled callers restore a connected opener or menu trigger without scrolling', () => {
  assert.match(dialog, /initialFocusRef.current.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /active.closest\('\[role="menu"\]'\)/);
  assert.match(dialog, /document.getElementById\(menuLabel\)/);
  assert.match(dialog, /target\?\.isConnected && !target.closest\('\[inert\]'\)/);
  assert.match(dialog, /target.focus\(\{ preventScroll: true \}\)/);
});

test('busy dialogs prevent both escape and outside dismissal', () => {
  assert.match(dialog, /if \(!next && dismissible\) onClose\?\.\(\)/);
  assert.match(dialog, /onEscapeKeyDown=\{[\s\S]*?if \(!dismissible\) event.preventDefault\(\)/);
  assert.match(dialog, /onPointerDownOutside=\{[\s\S]*?if \(!dismissible\) event.preventDefault\(\)/);
});

test('dialog and backdrop have independent enter/exit animations, not route fade classes', () => {
  assert.doesNotMatch(dialog, /className=.*fade-in/);
  for (const selector of ['.ui-dialog-overlay[data-state="open"]', '.ui-dialog-overlay[data-state="closed"]', '.ui-dialog-content[data-state="open"]', '.ui-dialog-content[data-state="closed"]']) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /ui-dialog-in 200ms/);
  assert.match(css, /ui-dialog-out 140ms/);
  assert.match(css, /translateY\(6px\) scale\(\.98\)/);
  assert.doesNotMatch(css, /transition:\s*all|scale\(0\)/);
});

test('reduced motion keeps only short opacity animations', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /animation-duration: 100ms/);
  assert.match(reduced, /@keyframes ui-dialog-in/);
  assert.match(reduced, /@keyframes ui-dialog-out/);
  assert.doesNotMatch(reduced, /transform:|translateY|scale\(/);
});

test('all modal variants use the shared foundation without competing custom focus traps', () => {
  const clients = ['components/ConfirmDialog.tsx', 'components/SpotifyLoginButton.tsx', 'components/song/DownloadDialog.tsx', 'app/songs/[id]/page.tsx', 'components/home/FavoriteCategoriesDialog.tsx', 'components/home/PlaylistImportDialog.tsx', 'components/admin/AdminSystemPanel.tsx', 'components/admin/LyricsProvidersPanel.tsx', 'components/admin/BlockUserDialog.tsx', 'components/admin/SongPreviewDialog.tsx'];
  for (const path of clients) {
    const text = source(path);
    assert.match(text, /from '@\/components\/ui\/dialog'/, path);
    assert.match(text, /<Dialog\b/, path);
    assert.doesNotMatch(text, /useModalFocus\(/, path);
    assert.doesNotMatch(text, /className="confirm-overlay|role="dialog"/, path);
  }
});

test('modal callers do not immediately unmount ConfirmDialog or DownloadDialog on close', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const inspect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (path.endsWith('.tsx')) {
        assert.doesNotMatch(readFileSync(path, 'utf8'), /\{[\w.]+\s*&&\s*\(?\s*<(?:ConfirmDialog|DownloadDialog)\b/, path);
      }
    }
  };
  inspect(root);
});

test('portal DOM order governs nested modal/menu layering instead of a permanently higher parent panel', () => {
  const dropdownCss = source('components/ui/dropdown-menu.css');
  const layers = [...css.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(layers, [100, 100]);
  assert.match(dropdownCss, /z-index:\s*100/);
});

test('dialog and menus share one Radix focus/layer/presence dependency generation', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const modal = lock.packages['node_modules/@radix-ui/react-dialog'].dependencies;
  const menu = lock.packages['node_modules/@radix-ui/react-menu'].dependencies;
  for (const name of ['@radix-ui/react-focus-scope', '@radix-ui/react-dismissable-layer', '@radix-ui/react-context', '@radix-ui/react-presence']) {
    assert.equal(modal[name], menu[name], `nested menu/dialog must share ${name}`);
  }
});

test('download resets its choices on each opening and login blocks dismissal while submitting', () => {
  const download = source('components/song/DownloadDialog.tsx');
  assert.match(download, /if \(wasOpen !== open\)/);
  assert.match(download, /setFormat\('text'\)/);
  assert.match(download, /setReading\('none'\)/);
  assert.match(download, /setIncludeTranslation\(false\)/);
  assert.match(source('components/SpotifyLoginButton.tsx'), /dismissible=\{!submitting\}/);
});
