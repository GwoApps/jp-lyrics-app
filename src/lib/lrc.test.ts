import assert from 'node:assert/strict';
import test from 'node:test';
import { offsetLrcLines, parseLrc, serializeLrc, updateLrcLineTime } from './lrc.ts';

test('offsetLrcLines shifts timestamps and clamps at zero', () => {
  const lines = parseLrc('[00:00.250]first\n[01:02.345]second');
  assert.deepEqual(offsetLrcLines(lines, -500), [
    { timeMs: 0, text: 'first' },
    { timeMs: 61845, text: 'second' },
  ]);
});

test('updateLrcLineTime keeps lines sorted by timestamp', () => {
  const lines = parseLrc('[00:01.000]one\n[00:02.000]two');
  assert.deepEqual(updateLrcLineTime(lines, 1, 500), [
    { timeMs: 500, text: 'two' },
    { timeMs: 1000, text: 'one' },
  ]);
});

test('serializeLrc emits stable millisecond timestamps', () => {
  assert.equal(
    serializeLrc([{ timeMs: 62345, text: 'hello' }]),
    '[01:02.345]hello',
  );
});

test('parseLrcTimestamp accepts editor timestamps and rejects invalid values', async () => {
  const { parseLrcTimestamp } = await import('./lrc.ts');
  assert.equal(parseLrcTimestamp('01:02.345'), 62345);
  assert.equal(parseLrcTimestamp('1:02.3'), 62300);
  assert.equal(parseLrcTimestamp('bad'), null);
});
