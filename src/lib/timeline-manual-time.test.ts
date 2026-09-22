import assert from 'node:assert/strict';
import test from 'node:test';
import { INVALID_TIME_FORMAT_KEY, manualTimeError, manualTimeErrorKey } from './timeline-manual-time.ts';
import { parseLrcTimestamp } from './lrc.ts';

test('manualTimeErrorKey flags every input parseLrcTimestamp rejects', () => {
  for (const value of ['1:5', '83.5', '83', '1:83', '1:23 .450', 'bad', '', '  ']) {
    assert.equal(parseLrcTimestamp(value), null, `${value} should not parse`);
    assert.equal(manualTimeErrorKey(value), INVALID_TIME_FORMAT_KEY, `${value} should surface the inline error`);
  }
});

test('manualTimeErrorKey stays silent for accepted timestamps', () => {
  for (const value of ['1:23.450', '01:02.345', '1:02.3', '0:00.000', ' 1:23.450 ']) {
    assert.notEqual(parseLrcTimestamp(value), null, `${value} should parse`);
    assert.equal(manualTimeErrorKey(value), null, `${value} should not surface an error`);
  }
});

test('manualTimeError always points at the four-locale dictionary key', () => {
  assert.equal(INVALID_TIME_FORMAT_KEY, 'timelineWorkspace.invalidTimeFormat');
  assert.equal(manualTimeError('1:5', (key) => `[${key}]`), `[${INVALID_TIME_FORMAT_KEY}]`);
  assert.equal(manualTimeError('1:23.450', (key) => `[${key}]`), null);
});
