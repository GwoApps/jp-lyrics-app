import test from 'node:test';
import assert from 'node:assert/strict';
import { seekReceiptTrackId } from './spotify-seek-receipt.ts';

test('post-seek observation prevents an update on the wrong track', () => {
  assert.equal(seekReceiptTrackId('track-a', { id: 'track-b', available: true }), 'track-b');
  assert.equal(seekReceiptTrackId('track-a', { id: null, available: true }), null);
});

test('a failed post-seek read does not delay a successful Spotify seek', () => {
  assert.equal(seekReceiptTrackId('track-a', { id: null, available: false }), 'track-a');
  assert.equal(seekReceiptTrackId('track-a', null), 'track-a');
});
