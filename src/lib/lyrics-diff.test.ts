import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLyrics, MAX_DIFF_ROWS } from './lyrics-diff.ts';

test('identical documents produce an empty diff', () => {
  const d = diffLyrics('A\nB\nC', 'A\nB\nC');
  assert.equal(d.totalChanges, 0);
  assert.deepEqual(d.rows, []);
});

test('CRLF-only transport differences are not changes', () => {
  const d = diffLyrics('A\nB', 'A\r\nB\r\n');
  assert.equal(d.totalChanges, 0);
});

test('a single added line is reported as an addition with its new line number', () => {
  const d = diffLyrics('A\nB\nC', 'A\nB\nX\nC');
  assert.equal(d.added, 1);
  assert.equal(d.removed, 0);
  assert.equal(d.changed, 0);
  assert.deepEqual(d.rows, [
    { newLine: 3, oldLine: null, type: 'added', text: 'X', oldText: '' },
  ]);
});

test('a single removed line is reported as a removal with its old line number', () => {
  const d = diffLyrics('A\nB\nC', 'A\nC');
  assert.equal(d.removed, 1);
  assert.deepEqual(d.rows, [
    { newLine: null, oldLine: 2, type: 'removed', text: '', oldText: 'B' },
  ]);
});

test('a replaced line is reported as changed (issue #493 blank-line repro)', () => {
  // Inserting a blank separator shifts all following rows — exactly the case
  // that used to silently reset furigana/translation without showing a diff.
  const d = diffLyrics('A\nB\nC', 'A\n\nB\nC');
  assert.equal(d.added, 1);
  assert.equal(d.totalChanges, 1);
  assert.equal(d.rows[0].newLine, 2);
});

test('back-to-back remove+add pair into a single changed row', () => {
  const d = diffLyrics('A\nB\nC', 'A\nX\nC');
  assert.equal(d.changed, 1);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
  assert.deepEqual(d.rows, [
    { newLine: 2, oldLine: 2, type: 'changed', text: 'X', oldText: 'B' },
  ]);
});

test('counts reflect the whole document while rows are truncated', () => {
  const before = Array.from({ length: 30 }, (_, i) => `old${i}`).join('\n');
  const after = Array.from({ length: 30 }, (_, i) => `new${i}`).join('\n');
  const d = diffLyrics(before, after);
  assert.equal(d.changed, 30);
  assert.equal(d.totalChanges, 30);
  assert.equal(d.rows.length, MAX_DIFF_ROWS);
});

test('maxRows parameter is respected', () => {
  const d = diffLyrics('A\nB\nC', 'X\nY\nZ', 2);
  assert.equal(d.totalChanges, 3);
  assert.equal(d.rows.length, 2);
});

test('whitespace differences are reported as a changed row', () => {
  const d = diffLyrics('A\nB', 'A \nB');
  assert.equal(d.changed, 1, 'trailing space is a real per-row change');
  assert.deepEqual(d.rows, [
    { newLine: 1, oldLine: 1, type: 'changed', text: 'A ', oldText: 'A' },
  ]);
});

test('trailing newline is not a content change', () => {
  // Both documents normalize to ['A','B'] — a trailing newline is not an
  // extra lyric row, so no cache-invalidating change is reported.
  assert.equal(diffLyrics('A\nB', 'A\nB\n').totalChanges, 0);
});

test('empty to full document shows the new lines as added', () => {
  const d = diffLyrics('', 'A\nB');
  assert.equal(d.added, 1);
  assert.equal(d.changed, 1);
  assert.deepEqual(d.rows.map((r) => r.text), ['A', 'B']);
});

test('legacy CRLF-stored lyrics show a diff when the folded write reshapes them', () => {
  // Mirrors hasLyricsContentChanged: the stored side keeps its `\r`, the
  // candidate side is folded to LF. A reset must never show an empty diff.
  const d = diffLyrics('A\r\nB', 'A\r\nB');
  assert.ok(d.totalChanges > 0, 'CRLF rows change when written as LF');
  assert.ok(d.rows.some((row) => row.type === 'changed' && row.oldText.endsWith('\r')));
});

test('any content change that invalidates caches yields at least one diff row', () => {
  const cases: Array<[string, string]> = [
    ['A\nB\nC', 'A\n\nB\nC'],
    ['A\nB\nC', 'A\nC\nB'],
    ['A\nB\nC', 'A\nB'],
    ['A\nB', ''],
    ['', 'A\nB'],
    ['A\r\nB', 'A\r\nB'],
  ];
  for (const [before, after] of cases) {
    assert.ok(diffLyrics(before, after).totalChanges > 0, `${JSON.stringify([before, after])}`);
  }
});
