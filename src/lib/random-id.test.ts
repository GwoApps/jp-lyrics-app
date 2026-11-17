import test from 'node:test';
import assert from 'node:assert/strict';
import { randomId } from './random-id.ts';

test('randomId returns a prefixed value on any runtime', () => {
  assert.match(randomId('draft:'), /^draft:.+/);
  assert.notEqual(randomId(), randomId());
});
