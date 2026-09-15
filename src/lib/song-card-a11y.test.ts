import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearCollectionFilterLabel,
  collectionRowLabel,
  deleteCollectionLabel,
  deleteSongLabel,
  favoriteLabel,
  type TranslateFn,
} from './song-card-a11y.ts';

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

test('deleteCollectionLabel includes the collection name for destructive-action confirmation', () => {
  const label = deleteCollectionLabel('My List', (key, vars) => `${key}:${vars?.name ?? ''}`);
  assert.equal(label, 'home.deleteCollectionLabel:My List');
});

test('clearCollectionFilterLabel names the target collection so the chip is not an unlabelled X', () => {
  const label = clearCollectionFilterLabel('My List', (key, vars) => `${key}:${vars?.name ?? ''}`);
  assert.equal(label, 'home.clearCollectionFilterLabel:My List');
});

test('collectionRowLabel reflects the current filter state', () => {
  assert.equal(collectionRowLabel('My List', false, t), '[home.filterByCollection]');
  assert.equal(collectionRowLabel('My List', true, t), '[home.unfilterByCollection]');
});

test('collectionRowLabel interpolates the collection name into the accessible name', () => {
  const label = collectionRowLabel('My List', false, (key, vars) => `${key}:${vars?.name ?? ''}`);
  assert.equal(label, 'home.filterByCollection:My List');
});
