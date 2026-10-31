import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSeek, trackIdentity, type SeekOverride, type SeekObservation } from './spotify-seek-override.ts';

const track = { id: 'track-a', uri: 'spotify:track:a', name: 'Song', artist: 'Artist' };
const playing = { connected: true, is_playing: true, progress_ms: 10_000, duration_ms: 180_000, track };
// Browser and server clocks are deliberately offset. Compare timestamps only within their own clock.
const seek: SeekOverride = {
  trackKey: trackIdentity(track), positionMs: 70_000, appliedAt: 1_000,
  clientAppliedAt: 20_000, serverAppliedAt: 50_000,
};
const client = (startedAt: number): SeekObservation => ({ source: 'client', startedAt });
const server = (startedAt: number): SeekObservation => ({ source: 'server', startedAt });

test('holds successful seek only against observations started before the response', () => {
  const first = reconcileSeek(playing, seek, 1_100, client(19_900));
  assert.equal(first.data.progress_ms, 70_100);
  assert.deepEqual(first.pending, seek);
  const second = reconcileSeek({ ...playing, progress_ms: 12_000 }, seek, 2_000, server(49_900));
  assert.equal(second.data.progress_ms, 71_000);
  assert.deepEqual(second.pending, seek);
  assert.equal(playing.progress_ms, 10_000, 'server observation must stay unmodified for SSE checksums');
});

test('the first post-seek observation is authoritative, including external same-track seeks', () => {
  for (const observation of [client(20_100), server(50_100)]) {
    const externalRewind = reconcileSeek({ ...playing, progress_ms: 0 }, seek, 2_000, observation);
    assert.equal(externalRewind.data.progress_ms, 0);
    assert.equal(externalRewind.pending, null);
  }
  const confirmed = reconcileSeek({ ...playing, progress_ms: 71_400 }, seek, 2_000, server(50_100));
  assert.equal(confirmed.data.progress_ms, 71_400);
  assert.equal(confirmed.pending, null);
  assert.equal(reconcileSeek({ ...playing, progress_ms: 74_000 }, confirmed.pending, 2_400, client(20_200)).data.progress_ms, 74_000);
});

test('never applies a seek to a different track or a disconnected session', () => {
  const changed = { ...playing, track: { ...track, id: 'track-b' } };
  assert.deepEqual(reconcileSeek(changed, seek, 1_100, server(49_900)), { data: changed, pending: null });
  const disconnected = { ...playing, connected: false };
  assert.deepEqual(reconcileSeek(disconnected, seek, 1_100, client(19_900)), { data: disconnected, pending: null });
});

test('expires the override if Spotify never provides a newer observation', () => {
  assert.deepEqual(reconcileSeek(playing, seek, 7_001, server(49_900)), { data: playing, pending: null });
});

test('paused playback holds its target and duration clamps interpolation', () => {
  const paused = { ...playing, is_playing: false };
  assert.equal(reconcileSeek(paused, seek, 2_500, client(19_900)).data.progress_ms, 70_000);
  assert.equal(reconcileSeek({ ...playing, duration_ms: 70_500 }, seek, 2_500, server(49_900)).data.progress_ms, 70_500);
});
