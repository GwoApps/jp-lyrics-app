import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLineEdits,
  computeLineEdits,
  countAdoptedLines,
  parseLineEdits,
  reconcileDraft,
} from './translation-line-edits.ts';

/**
 * Line-level translation edit helpers (issue #272).
 *
 * These are the wire contract shared by the proofreading page and
 * `PUT /api/songs/[id]/translation`: the client diffs its draft, the server
 * validates the change-set against the current lyrics, and the merged result is
 * folded back into the editor. Every case below is a way a whole-snapshot write
 * used to lose data.
 */

const SOURCE = ['line one', 'line two', '', 'line four'];

test('computeLineEdits sends only the lines that actually changed', () => {
  const baseline = ['一', '', '旧', '四'];
  const draft = ['一', '二', '旧', '四'];
  assert.deepEqual(computeLineEdits(draft, baseline), [{ index: 1, translation: '二' }]);
});

test('computeLineEdits drops lines whose stored value another session changed', () => {
  // The editor's baseline was empty for lines 2/3; the user only touched line 0.
  // A whole-array save would have written the stale '' for lines 2/3.
  const baseline = ['', '', '', ''];
  const draft = ['我的翻译', '', '', ''];
  assert.deepEqual(computeLineEdits(draft, baseline), [{ index: 0, translation: '我的翻译' }]);
});

test('computeLineEdits treats whitespace-only differences as no change (stays clean after save)', () => {
  // The write path stores trimmed values, so comparing raw strings would leave
  // the editor permanently dirty after saving a line with a trailing space.
  assert.deepEqual(computeLineEdits(['一 '], ['一']), []);
  assert.deepEqual(computeLineEdits([' 一'], ['一']), []);
});

test('computeLineEdits reports clearing a line as a change', () => {
  assert.deepEqual(computeLineEdits([''], ['译文']), [{ index: 0, translation: '' }]);
});

test('computeLineEdits handles length differences without shifting indices', () => {
  assert.deepEqual(computeLineEdits(['一', '二'], ['一']), [{ index: 1, translation: '二' }]);
  assert.deepEqual(computeLineEdits(['一'], ['一', '二']), [{ index: 1, translation: '' }]);
});

test('parseLineEdits rejects a non-array or malformed change-set', () => {
  assert.deepEqual(parseLineEdits(undefined, SOURCE), { ok: false, error: 'missing_changes' });
  assert.deepEqual(parseLineEdits('nope', SOURCE), { ok: false, error: 'missing_changes' });
  assert.deepEqual(parseLineEdits([null], SOURCE), { ok: false, error: 'invalid_changes' });
  assert.deepEqual(parseLineEdits([{ index: '0', translation: '一' }], SOURCE), { ok: false, error: 'invalid_changes' });
  assert.deepEqual(parseLineEdits([{ index: 1.5, translation: '一' }], SOURCE), { ok: false, error: 'invalid_changes' });
  assert.deepEqual(parseLineEdits([{ index: 1 }], SOURCE), { ok: false, error: 'invalid_changes' });
  assert.deepEqual(parseLineEdits([{ index: -1, translation: '一' }], SOURCE), { ok: false, error: 'invalid_changes' });
  // Out of range for the CURRENT lyrics — a change-set built for older lyrics
  // must be refused instead of landing on a shifted line.
  assert.deepEqual(parseLineEdits([{ index: 4, translation: '一' }], SOURCE), { ok: false, error: 'invalid_changes' });
});

test('parseLineEdits trims, collapses duplicate indices and forces blank source lines empty', () => {
  const parsed = parseLineEdits([
    { index: 1, translation: ' 二 ' },
    { index: 1, translation: '二改' },
    { index: 2, translation: '不该存在' }, // line 2 is blank in the source
    { index: 0, translation: '一' },
  ], SOURCE);
  assert.deepEqual(parsed, {
    ok: true,
    edits: [
      { index: 0, translation: '一' },
      { index: 1, translation: '二改' },
      { index: 2, translation: '' },
    ],
  });
});

test('parseLineEdits accepts an empty change-set (nothing to do)', () => {
  assert.deepEqual(parseLineEdits([], SOURCE), { ok: true, edits: [] });
});

test('applyLineEdits writes only the edited lines and keeps the cache line-aligned', () => {
  const base = ['', '', '三', '四'];
  // Total lines grew: the result is normalised to the current lyrics length.
  assert.deepEqual(applyLineEdits(base, [{ index: 0, translation: '一' }], 5), ['一', '', '三', '四', '']);
  // Shorter source: extra cached lines are dropped, never shifted.
  assert.deepEqual(applyLineEdits(base, [{ index: 0, translation: '一' }], 3), ['一', '', '三']);
  // Out-of-range edits are ignored (never appended).
  assert.deepEqual(applyLineEdits(base, [{ index: 9, translation: 'x' }], 4), ['', '', '三', '四']);
});

test('reconcileDraft adopts the merged cache but keeps lines typed during the save', () => {
  const baseline = ['', '', '', ''];
  const submitted = ['我的翻译', '', '', '']; // what the save sent
  const merged = ['我的翻译', '', 'AI 后来写的', 'AI 后来写的'];
  // Untouched since the request went out → adopt (user's line was trimmed too).
  assert.deepEqual(reconcileDraft(submitted, submitted, merged), merged);
  // The user kept typing line 3 while the save was in flight → keep it.
  const typed = ['我的翻译', '', '', '我正在输入'];
  assert.deepEqual(reconcileDraft(typed, submitted, merged), ['我的翻译', '', 'AI 后来写的', '我正在输入']);
  // Trimming: the server stored 'x' while the editor held ' x ' → adopt, so the
  // editor is not left permanently dirty.
  assert.deepEqual(reconcileDraft([' x '], [' x '], ['x']), ['x']);
  // Defensive: a shorter merged array never truncates the draft.
  assert.deepEqual(reconcileDraft(['a', 'b'], ['a', 'b'], ['a']), ['a', 'b']);
  void baseline;
});

test('countAdoptedLines counts lines taken from another session, not the user\'s own edits', () => {
  const baseline = ['', '', '', ''];
  const edits = [{ index: 0, translation: '我的翻译' }];
  const merged = ['我的翻译', '', 'AI', 'AI'];
  assert.equal(countAdoptedLines(baseline, edits, merged), 2);
  // Nothing written elsewhere → a plain success toast.
  assert.equal(countAdoptedLines(baseline, edits, ['我的翻译', '', '', '']), 0);
  // Lines the editor itself edited are never counted as "adopted from elsewhere".
  assert.equal(countAdoptedLines(baseline, [{ index: 0, translation: '' }], ['x', '', '', '']), 0);
});
