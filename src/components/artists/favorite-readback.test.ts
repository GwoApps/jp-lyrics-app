import assert from 'node:assert/strict';
import test from 'node:test';
import { createFavoriteReadbackGate } from './favorite-readback.ts';

test('older favorite responses and errors cannot supersede a newer edit of the same song', async () => {
  const gate = createFavoriteReadbackGate();
  const first = gate.begin('song');
  const second = gate.begin('song');
  const other = gate.begin('other');
  let state: boolean | null = null;
  if (gate.isCurrent('song', second)) state = false;
  await Promise.resolve();
  if (gate.isCurrent('song', first)) state = true;
  assert.equal(state, false);
  assert.equal(gate.isCurrent('song', first), false);
  assert.equal(gate.isCurrent('other', other), true);
});
