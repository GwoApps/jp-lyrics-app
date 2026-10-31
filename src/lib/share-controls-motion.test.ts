import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const page = read('app/songs/[id]/share/page.tsx');
const css = read('components/share/share-controls.css');
const feedback = read('components/share/ShareCopyFeedback.tsx');

// Static DOM/style contracts, not browser/perceptual animation measurements.
test('lyric selection exposes toggle semantics and keeps the check mounted for both directions', () => {
  assert.match(page, /aria-pressed=\{selected.has\(idx\)\}/);
  assert.match(page, /data-selected=\{selected.has\(idx\)\}/);
  assert.match(page, /<Check className="share-lyric-item__check h-3\.5 w-3\.5" \/>/);
  assert.doesNotMatch(page, /selected.has\(idx\) && <Check/);
  assert.match(page, /song-editor-choice--active/);
});

test('lyric row, checkbox background and check icon each have targeted reversible transitions', () => {
  assert.match(css, /\.share-lyric-item\s*\{[^}]*transition:\s*background-color 160ms ease, color 160ms ease/);
  assert.match(css, /\.share-lyric-item__checkbox\s*\{[^}]*background-color[^}]*border-color/);
  assert.match(css, /\.share-lyric-item__check\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*scale\(\.9\);[^}]*transition:\s*opacity/);
  assert.match(css, /\[data-selected="true"\] \.share-lyric-item__check\s*\{\s*opacity:\s*1;\s*transform:\s*scale\(1\)/);
  assert.doesNotMatch(css, /transition:\s*all|@keyframes/);
});

test('copy feedback retains both visual labels in one intrinsic grid cell and one live accessible label', () => {
  assert.match(feedback, /data-copied=\{copied\}/);
  assert.match(feedback, /share-copy-feedback__default" aria-hidden="true"/);
  assert.match(feedback, /share-copy-feedback__success" aria-hidden="true"/);
  assert.match(feedback, /aria-live="polite" aria-atomic="true">\{copied \? copiedLabel : label\}/);
  assert.match(css, /\.share-copy-feedback\s*\{\s*display:\s*inline-grid/);
  assert.match(css, /grid-area:\s*1 \/ 1/);
  assert.match(css, /\[data-copied="true"\] \.share-copy-feedback__default\s*\{\s*opacity:\s*0/);
  assert.match(css, /\[data-copied="true"\] \.share-copy-feedback__success\s*\{\s*opacity:\s*1/);
});

test('both copy-lyrics actions use localized transition feedback and preserve the copy payload builder', () => {
  assert.equal((page.match(/<ShareCopyFeedback /g) ?? []).length, 2);
  assert.match(page, /copiedKind === 'lyrics'\} label=\{t\('share.copyLyrics'\)\}/);
  assert.match(page, /copiedKind === 'lyricsWithTranslation'\} label=\{t\('share.copyLyricsWithTranslation'\)\}/);
  assert.match(page, /copyText\(buildShareCopyText\(lyricLines, kind === 'lyricsWithTranslation'\), kind\)/);
});

test('repeat copies restart the success lifetime and stale or unmounted completions cannot update feedback', () => {
  assert.match(page, /if \(copiedTimerRef.current\) clearTimeout\(copiedTimerRef.current\);\s*setCopiedKind\(kind\)/);
  assert.match(page, /copiedTimerRef.current = setTimeout\([\s\S]*?setCopiedKind\(null\);[\s\S]*?1500\)/);
  assert.match(page, /const request = \+\+copyRequestRef.current;[\s\S]*?await copyToClipboard\(text\);\s*if \(request !== copyRequestRef.current\) return/);
  assert.match(page, /useEffect\(\(\) => \(\) => \{\s*copyRequestRef.current \+= 1;\s*if \(copiedTimerRef.current\) clearTimeout/);
  assert.match(page, /if \(!ok\) \{\s*setToast\([\s\S]*?return;/);
});

test('responsive column width follows completed preview orientation rather than a pending draw', () => {
  assert.match(page, /data-orientation=\{previewOrientation\}/);
  assert.match(page, /if \(value\) setPreviewOrientation\(orientation\)/);
  assert.match(page, /onReadyChange=\{handlePreviewReady\}/);
  assert.match(css, /transition:\s*max-width var\(--song-player-motion-duration, 220ms\)/);
  assert.match(css, /data-orientation="portrait"[^}]*max-width:\s*28rem/);
});

test('reduced motion removes size/position changes but retains gentle feedback fades', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.share-page-content \{ transition:\s*none/);
  assert.match(reduced, /transition:\s*opacity 100ms linear/);
  // Match the selected-state specificity, not a weaker override that silently loses.
  assert.match(reduced, /\.share-copy-feedback\[data-copied\] \.share-copy-feedback__state \{ transform:\s*none/);
});

test('completed share frames crossfade without stretching while the preview aspect ratio interpolates', () => {
  const previewCss = read('components/share/share-card-preview.css');
  assert.match(previewCss, /transition:\s*aspect-ratio var\(--song-player-motion-duration, 220ms\)/);
  assert.match(previewCss, /object-fit:\s*contain/);
  assert.match(previewCss, /@keyframes share-card-preview-enter\s*\{\s*from \{ opacity:\s*0; \}\s*to \{ opacity:\s*1;/);
  assert.match(previewCss, /data-has-frame[^}]*display:\s*none/);
  const reduced = previewCss.slice(previewCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /transition:\s*none/);
  assert.match(reduced, /animation-duration:\s*100ms/);
});

test('downloads retain a complete full-resolution frame rather than an animated or partly rendered bitmap', () => {
  const preview = read('components/share/ShareCardPreview.tsx');
  assert.match(preview, /const canvas = document.createElement\('canvas'\)/);
  assert.match(preview, /presentation.present\(frame\);\s*canvasRef.current = latest = frame/);
  assert.match(preview, /request\(enabled \? draw : null\)/);
  assert.doesNotMatch(preview, /toDataURL|toBlob/);
  assert.match(page, /const canvas = canvasRef.current/);
  assert.match(page, /canvas.toBlob\(/);
  assert.match(page, /disabled=\{!ready\}/);
});
