import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimelineDraftLine } from './lrc.ts';
import {
  applyUndo,
  pushLineEntry,
  pushSnapshotEntry,
  MAX_HISTORY,
  type HistoryEntry,
} from './timeline-history.ts';

function line(timeMs: number | null, text = 'x'): TimelineDraftLine {
  return { timeMs, text };
}

test('pushLineEntry appends a line entry and caps the stack at MAX_HISTORY', () => {
  let history: HistoryEntry[] = [];
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
    history = pushLineEntry(history, i, null);
  }
  assert.equal(history.length, MAX_HISTORY);
  const last = history[history.length - 1];
  assert.equal(last.type, 'line');
  if (last.type === 'line') assert.equal(last.index, MAX_HISTORY + 4);
});

test('pushSnapshotEntry appends a snapshot entry and caps the stack', () => {
  let history: HistoryEntry[] = [];
  for (let i = 0; i < MAX_HISTORY + 3; i += 1) {
    history = pushSnapshotEntry(history, [line(i)]);
  }
  assert.equal(history.length, MAX_HISTORY);
  const last = history[history.length - 1];
  assert.equal(last.type, 'snapshot');
});

test('applyUndo on empty history returns empty result and unchanged lines', () => {
  const current = [line(100), line(200)];
  const result = applyUndo([], current);
  assert.deepEqual(result.entries, []);
  assert.equal(result.lines, undefined);
});

test('applyUndo restores a single-line edit via previousTime', () => {
  const current = [line(100, 'a'), line(50, 'b'), line(300, 'c')];
  const history = pushLineEntry([], 1, 999);
  const result = applyUndo(history, current);
  assert.deepEqual(result.entries, []);
  assert.equal(result.lineIndex, 1);
  assert.equal(result.previousTime, 999);
  assert.deepEqual(result.lines, [line(100, 'a'), line(999, 'b'), line(300, 'c')]);
});

test('applyUndo restores a snapshot before an offset', () => {
  const before = [line(100, 'a'), line(200, 'b'), line(300, 'c')];
  const after = before.map((l) => line(l.timeMs == null ? null : l.timeMs + 300, l.text));
  const history = pushSnapshotEntry([], before);
  const result = applyUndo(history, after);
  assert.deepEqual(result.entries, []);
  assert.equal(result.lineIndex, undefined);
  assert.deepEqual(result.lines, before);
});

test('applyUndo restores a snapshot before a sort, preserving row order', () => {
  const before = [line(300, 'c'), line(100, 'a'), line(200, 'b')];
  const after = [line(100, 'a'), line(200, 'b'), line(300, 'c')];
  const history = pushSnapshotEntry([], before);
  const result = applyUndo(history, after);
  assert.deepEqual(result.lines, before);
});

test('mixed history: undo pops the most recent entry first (LIFO)', () => {
  const current = [line(100, 'a')];
  const history = pushLineEntry(
    pushSnapshotEntry([], [line(50, 'a')]),
    0,
    42,
  );
  // Top entry is the line edit.
  const first = applyUndo(history, current);
  assert.deepEqual(first.lines, [line(42, 'a')]);
  assert.equal(first.entries.length, 1);
  // Second undo pops the snapshot.
  const second = applyUndo(first.entries, first.lines!);
  assert.deepEqual(second.lines, [line(50, 'a')]);
  assert.equal(second.entries.length, 0);
});
