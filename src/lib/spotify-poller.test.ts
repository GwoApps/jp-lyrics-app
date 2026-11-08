import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotifyPoller, type DiffMessage, type NowPlayingData } from './spotify-poller-core.ts';
import { SPOTIFY_TIMEOUT_STATUS, isSpotifyAuthError, isSpotifyTimeoutError, isSpotifyTransientError } from './spotify-error.ts';

/**
 * Issue #370 — a Spotify upstream that accepts the connection and then never
 * answers must not stop the server-side poller.
 *
 * The old `tick()` only scheduled the next round from the success and error
 * paths. A pending `await fetchNowPlaying()` reached neither, so that user's
 * poller stopped permanently while SSE kept sending heartbeats — no degraded
 * event, nothing to recover short of a process restart.
 *
 * These tests drive the real state machine with injected dependencies (short
 * intervals, a hanging observation) so "still rescheduled after a hang" is
 * asserted directly instead of being reproducible only in production.
 */

// Real values are 2s poll / 8s budget / 2s base backoff; the tests compress the
// same shape so a hang is observable in milliseconds.
const POLL_INTERVAL_MS = 30;
const OBSERVATION_BUDGET_MS = 10;
const BACKOFF_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function playback(overrides: Partial<NowPlayingData> = {}): NowPlayingData {
  return {
    connected: true,
    is_playing: true,
    progress_ms: 1000,
    duration_ms: 200_000,
    track: { id: 'track1', uri: 'spotify:track:track1', name: 'Song', artist: 'Artist', album: 'Album' },
    ...overrides,
  };
}

/** Records every state broadcast so the test can assert on the visible outcome. */
function recorder() {
  const states: (string | undefined)[] = [];
  const messages: DiffMessage[] = [];
  // `data` is the poller's current view; `diff.d` only carries changed fields.
  const connectedData: NowPlayingData[] = [];
  return {
    states,
    messages,
    connectedData,
    subscriber: (data: NowPlayingData, diff: DiffMessage) => {
      states.push(diff._sync);
      messages.push(diff);
      connectedData.push(data);
    },
  };
}

test('a hung observation still reschedules, degrades to retrying, and recovers', async () => {
  let calls = 0;
  // Keep the stalled observation resolvable so the test leaves no promise behind.
  let releaseHang: (data: NowPlayingData) => void = () => {};
  const poller = createSpotifyPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    observationBudgetMs: OBSERVATION_BUDGET_MS,
    backoff: () => BACKOFF_MS,
    fetchNowPlaying: async () => {
      calls += 1;
      if (calls === 1) {
        return await new Promise<NowPlayingData>((resolve) => { releaseHang = resolve; }); // never answers in time
      }
      return playback();
    },
  });

  const rec = recorder();
  const unsubscribe = poller.subscribe('user@example.com', rec.subscriber);

  await sleep(OBSERVATION_BUDGET_MS * 4);
  assert.equal(calls, 1, 'only the first observation ran so far');
  assert.ok(rec.states.length > 0, 'subscribers were notified about the stall');
  assert.equal(rec.states.at(-1), 'retrying', 'degraded state broadcast');
  assert.equal(rec.messages.at(-1)?.d.error, SPOTIFY_TIMEOUT_STATUS, 'timeout surfaced as a transient code');

  // The next round runs on its own and recovers to the normal cadence.
  await sleep(BACKOFF_MS * 4);
  assert.ok(calls >= 2, `the poller kept rescheduling (${calls} observations)`);
  assert.equal(rec.states.at(-1), 'connected');
  assert.equal(rec.connectedData.at(-1)?.progress_ms, 1000);
  assert.equal(rec.connectedData.at(-1)?.error, undefined, 'the recovered state has no error');
  // JSON drops `undefined`, so "the error cleared" must be an explicit null —
  // otherwise the client keeps showing the previous timeout warning forever.
  const cleared = rec.messages.some((message) => (message.d as { error?: number | null }).error === null);
  assert.ok(cleared, 'recovery is sent as an explicit null diff');

  unsubscribe();
  releaseHang(playback());
  const callsAfterUnsubscribe = calls;
  await sleep(POLL_INTERVAL_MS * 10);
  assert.equal(calls, callsAfterUnsubscribe, 'unsubscribing stops the poller');
});

test('a hang never walks the user into "stopped" — sync keeps retrying', async () => {
  let calls = 0;
  const poller = createSpotifyPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    observationBudgetMs: OBSERVATION_BUDGET_MS,
    backoff: () => BACKOFF_MS,
    fetchNowPlaying: async () => {
      calls += 1;
      return await new Promise<NowPlayingData>(() => {});
    },
  });

  const rec = recorder();
  const unsubscribe = poller.subscribe('user@example.com', rec.subscriber);

  // Comfortably past the default MAX_CONSECUTIVE_ERRORS (4).
  await sleep(BACKOFF_MS * 12);

  assert.ok(calls >= 5, `kept polling (${calls} observations)`);
  assert.ok(!rec.states.includes('stopped'), 'a timeout is transient, never a permanent stop');
  assert.equal(rec.states.at(-1), 'retrying');
  unsubscribe();
});

test('a non-timeout failure still stops after the error threshold, and only resume restarts it', async () => {
  let calls = 0;
  const poller = createSpotifyPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    observationBudgetMs: OBSERVATION_BUDGET_MS,
    backoff: () => BACKOFF_MS,
    maxConsecutiveErrors: 2,
    fetchNowPlaying: async () => {
      calls += 1;
      throw new Error('boom');
    },
  });

  const rec = recorder();
  const unsubscribe = poller.subscribe('user@example.com', rec.subscriber);

  await sleep(BACKOFF_MS * 6);
  const callsWhenStopped = calls;
  assert.equal(callsWhenStopped, 2, 'stopped after the configured threshold');
  assert.equal(rec.states.at(-1), 'stopped');
  await sleep(BACKOFF_MS * 6);
  assert.equal(calls, callsWhenStopped, 'a stopped poller holds no timer');

  // Manual resume is the only way back.
  poller.resumePolling('user@example.com');
  await sleep(POLL_INTERVAL_MS);
  assert.ok(calls > callsWhenStopped, 'resume triggers a fresh observation');
  unsubscribe();
});

test('a transient 429 restores the normal cadence without counting toward the stop', async () => {
  const responses: NowPlayingData[] = [
    playback({ error: 429, track: null, is_playing: false, progress_ms: 0, duration_ms: 0 }),
    playback(),
  ];
  const poller = createSpotifyPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    observationBudgetMs: OBSERVATION_BUDGET_MS,
    backoff: () => BACKOFF_MS,
    maxConsecutiveErrors: 1,
    fetchNowPlaying: async () => responses.shift() ?? playback(),
  });

  const rec = recorder();
  const unsubscribe = poller.subscribe('user@example.com', rec.subscriber);

  await sleep(OBSERVATION_BUDGET_MS);
  assert.equal(rec.states[0], 'retrying');
  await sleep(BACKOFF_MS * 4);
  assert.ok(rec.states.includes('connected'), 'recovered instead of stopping');
  unsubscribe();
});

test('one broken subscriber does not abort the broadcast for the others', async () => {
  const poller = createSpotifyPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    observationBudgetMs: OBSERVATION_BUDGET_MS,
    backoff: () => BACKOFF_MS,
    fetchNowPlaying: async () => playback(),
  });

  const rec = recorder();
  const unsubscribeBroken = poller.subscribe('user@example.com', () => { throw new Error('closed stream'); });
  const unsubscribeHealthy = poller.subscribe('user@example.com', rec.subscriber);

  await sleep(POLL_INTERVAL_MS * 3);
  assert.ok(rec.messages.length > 0, 'the healthy subscriber kept receiving updates');
  unsubscribeBroken();
  unsubscribeHealthy();
});

test('the timeout code is transient but never reported as an auth problem', () => {
  assert.equal(isSpotifyTimeoutError(SPOTIFY_TIMEOUT_STATUS), true);
  assert.equal(isSpotifyTransientError(SPOTIFY_TIMEOUT_STATUS), true);
  assert.equal(isSpotifyAuthError(SPOTIFY_TIMEOUT_STATUS), false);
  assert.equal(SPOTIFY_TIMEOUT_STATUS, 504);
});
