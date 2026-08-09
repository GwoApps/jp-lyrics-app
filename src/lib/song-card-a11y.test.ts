import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSongLabel, favoriteLabel, type TranslateFn } from './song-card-a11y.ts';

const t: TranslateFn = (key, vars) => {
  let value = `[${key}]`;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) value = value.replace(`{${k}}`, String(v));
  }
  return value;
};

test('favoriteLabel reflects the current favorite state', () => {
  assert.equal(favoriteLabel(false, 'My Song', t), '[home.addToFavorites]');
  assert.equal(favoriteLabel(true, 'My Song', t), '[home.removeFromFavorites]');
});

test('favoriteLabel interpolates the song title into the accessible name', () => {
  const label = favoriteLabel(false, 'My Song', (key, vars) => `${key}:${vars?.title ?? ''}`);
  assert.equal(label, 'home.addToFavorites:My Song');
});

test('deleteSongLabel includes the song title for destructive-action confirmation', () => {
  const label = deleteSongLabel('My Song', (key, vars) => `${key}:${vars?.title ?? ''}`);
  assert.equal(label, 'home.deleteSongLabel:My Song');
});
