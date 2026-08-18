import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEndpoints,
  getNetworkPolicy,
  isPrivateIpv4,
  isPrivateIpv6,
  normalizeProviderBaseUrl,
  validateProviderBaseUrl,
} from './lyrics-provider/policy.ts';
import {
  PROVIDER_DEFAULT_TIMEOUT_MS,
  PROVIDER_MAX_TIMEOUT_MS,
  clampConfiguredTimeoutMs,
  resolveProviderTimeoutMs,
} from './lyrics-provider/budget.ts';
import { parseManifest, parseCandidate } from './lyrics-provider/http-client.ts';
import { MAX_CANDIDATES_PER_PROVIDER } from './lyrics-provider/normalize.ts';
import { normalizeCandidateLyrics } from './lyrics-provider/normalize.ts';
import { hasProviderSecretKey, maskSecret } from './lyrics-provider/secret.ts';

// ─── Policy: private IP detection ─────────────────────────────

test('isPrivateIpv4 classifies RFC1918 / loopback / link-local / metadata ranges', () => {
  assert.equal(isPrivateIpv4('127.0.0.1'), true);
  assert.equal(isPrivateIpv4('10.0.0.5'), true);
  assert.equal(isPrivateIpv4('172.16.0.1'), true);
  assert.equal(isPrivateIpv4('192.168.1.1'), true);
  assert.equal(isPrivateIpv4('169.254.169.254'), true);
  assert.equal(isPrivateIpv4('100.64.0.1'), true);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('1.1.1.1'), false);
});

test('isPrivateIpv6 detects loopback / link-local / unique-local / v4-mapped', () => {
  assert.equal(isPrivateIpv6('::1'), true);
  assert.equal(isPrivateIpv6('fe80::1'), true);
  assert.equal(isPrivateIpv6('fd00::1'), true);
  assert.equal(isPrivateIpv6('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIpv6('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateIpv6('2606:4700::1'), false);
});

test('normalizeProviderBaseUrl keeps path prefix and trims trailing slash', () => {
  assert.equal(normalizeProviderBaseUrl('https://example.com/providers/lrclib-proxy/'), 'https://example.com/providers/lrclib-proxy');
  assert.equal(normalizeProviderBaseUrl('https://example.com/team-a/japanese-lyrics'), 'https://example.com/team-a/japanese-lyrics');
  // Root path keeps a single trailing slash.
  assert.equal(normalizeProviderBaseUrl('https://example.com/'), 'https://example.com');
  // userinfo / query / fragment are rejected.
  assert.equal(normalizeProviderBaseUrl('https://user:pass@example.com/x'), null);
  assert.equal(normalizeProviderBaseUrl('https://example.com/x?y=1'), null);
  assert.equal(normalizeProviderBaseUrl('ftp://example.com/x'), null);
});

test('deriveEndpoints resolves relative to the base path, never the Origin root', () => {
  const { manifestUrl, searchUrl } = deriveEndpoints('https://example.com/providers/lrclib-proxy');
  assert.equal(manifestUrl, 'https://example.com/providers/lrclib-proxy/manifest.json');
  assert.equal(searchUrl, 'https://example.com/providers/lrclib-proxy/v1/search');
});

test('validateProviderBaseUrl rejects http when disallowed, unsafe hosts, and metadata always', async () => {
  // HTTP disallowed by default.
  assert.equal(await validateProviderBaseUrl('http://example.com/x', { allowHttp: false, allowPrivateNetwork: false }), 'http_disallowed');
  // Metadata always forbidden, even when private network is allowed.
  assert.equal(await validateProviderBaseUrl('http://169.254.169.254/latest', { allowHttp: true, allowPrivateNetwork: true }), 'metadata_forbidden');
  assert.equal(await validateProviderBaseUrl('https://169.254.169.254/', { allowHttp: true, allowPrivateNetwork: true }), 'metadata_forbidden');
  // Loopback private IP rejected unless private net allowed.
  assert.equal(await validateProviderBaseUrl('https://127.0.0.1:8787/', { allowHttp: false, allowPrivateNetwork: false }), 'unsafe_host');
  // Public https is fine.
  assert.equal(await validateProviderBaseUrl('https://example.com/x', { allowHttp: false, allowPrivateNetwork: false }), null);
});

test('validateProviderBaseUrl allows private network when the switch is on', async () => {
  // 127.0.0.1 with private net allowed.
  assert.equal(await validateProviderBaseUrl('https://127.0.0.1:8787/', { allowHttp: true, allowPrivateNetwork: true }), null);
});

test('getNetworkPolicy fails closed on invalid / missing env booleans', () => {
  const prevHttp = process.env.LYRICS_PROVIDER_ALLOW_HTTP;
  const prevNet = process.env.LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK;
  try {
    process.env.LYRICS_PROVIDER_ALLOW_HTTP = 'TRUE';
    process.env.LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK = 'yes'; // not 'true' → false
    const policy = getNetworkPolicy();
    assert.equal(policy.allowHttp, true);
    assert.equal(policy.allowPrivateNetwork, false);
  } finally {
    if (prevHttp === undefined) delete process.env.LYRICS_PROVIDER_ALLOW_HTTP; else process.env.LYRICS_PROVIDER_ALLOW_HTTP = prevHttp;
    if (prevNet === undefined) delete process.env.LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK; else process.env.LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK = prevNet;
  }
});

// ─── Budget ───────────────────────────────────────────────────

test('resolveProviderTimeoutMs falls back to the default and clamps to the max', () => {
  const budget = {
    defaultTimeoutMs: PROVIDER_DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: PROVIDER_MAX_TIMEOUT_MS,
    manifestTimeoutMs: 15000,
    chainTimeoutMs: 180000,
  };
  assert.equal(resolveProviderTimeoutMs(null, budget), PROVIDER_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveProviderTimeoutMs(undefined, budget), PROVIDER_DEFAULT_TIMEOUT_MS);
  // Below the 5s floor is clamped up.
  assert.equal(resolveProviderTimeoutMs(1000, budget), 5000);
  // Above the max is clamped down.
  assert.equal(resolveProviderTimeoutMs(120000, budget), PROVIDER_MAX_TIMEOUT_MS);
  assert.equal(resolveProviderTimeoutMs(30000, budget), 30000);
});

test('clampConfiguredTimeoutMs returns null for blank and clamps valid ranges', () => {
  const budget = {
    defaultTimeoutMs: 20000,
    maxTimeoutMs: 60000,
    manifestTimeoutMs: 15000,
    chainTimeoutMs: 180000,
  };
  assert.equal(clampConfiguredTimeoutMs(null, budget), null);
  assert.equal(clampConfiguredTimeoutMs(undefined, budget), null);
  assert.equal(clampConfiguredTimeoutMs(NaN, budget), null);
  assert.equal(clampConfiguredTimeoutMs(120000, budget), 60000);
  assert.equal(clampConfiguredTimeoutMs(30000, budget), 30000);
});

// ─── Manifest / schema validation ─────────────────────────────

test('parseManifest accepts a valid manifest and caps max_candidates', () => {
  const ok = parseManifest({
    protocol: 'jplrc-lyrics-provider',
    protocol_version: 1,
    id: 'p',
    name: 'Provider',
    version: '1.0.0',
    capabilities: ['search', 'synced'],
    limits: { max_candidates: 500 },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.manifest.id, 'p');
    assert.equal(ok.manifest.limits.maxCandidates, MAX_CANDIDATES_PER_PROVIDER);
  }
});

test('parseManifest rejects wrong protocol / version / non-object', () => {
  assert.equal(parseManifest({ protocol: 'other', protocol_version: 1 }).ok, false);
  assert.equal(parseManifest({ protocol: 'jplrc-lyrics-provider', protocol_version: 2 }).ok, false);
  assert.equal(parseManifest('nope').ok, false);
  assert.equal(parseManifest({}).ok, false);
});

test('parseCandidate requires plain or synced lyrics and caps field length', () => {
  assert.equal(parseCandidate({ title: 't', artists: ['a'], plain_lyrics: 'x' })?.plainLyrics, 'x');
  assert.equal(parseCandidate({ title: 't', synced_lyrics: '[00:00.00]x' })?.syncedLyrics, '[00:00.00]x');
  // No lyrics at all → dropped.
  assert.equal(parseCandidate({ title: 't', artists: [] }), null);
  // Oversized field → dropped.
  assert.equal(parseCandidate({ title: 't', plain_lyrics: 'x'.repeat(200001) }), null);
});

// ─── Normalize ────────────────────────────────────────────────

test('normalizeCandidateLyrics decodes entities and derives plain from synced', () => {
  const out = normalizeCandidateLyrics({ syncedLyrics: '[00:01.00]Tom &amp; Jerry', plainLyrics: '' });
  assert.equal(out.plain, 'Tom & Jerry');
  assert.equal(out.synced, '[00:01.00]Tom & Jerry');
});

// ─── Secret helpers (non-crypto pure functions) ───────────────

test('maskSecret masks short and long values without revealing plaintext', () => {
  assert.equal(maskSecret(''), null);
  assert.equal(maskSecret(null), null);
  assert.equal(maskSecret(undefined), null);
  assert.equal(maskSecret('short'), '••••');
  assert.match(maskSecret('abcdefghijklmnop')!, /^abcd/);
  assert.equal(maskSecret('abcdefghijklmnop'), 'abcd...mnop');
});

test('hasProviderSecretKey reflects the env var', () => {
  const prev = process.env.LYRICS_PROVIDER_SECRET_KEY;
  try {
    delete process.env.LYRICS_PROVIDER_SECRET_KEY;
    assert.equal(hasProviderSecretKey(), false);
    process.env.LYRICS_PROVIDER_SECRET_KEY = 'some-key';
    assert.equal(hasProviderSecretKey(), true);
  } finally {
    if (prev === undefined) delete process.env.LYRICS_PROVIDER_SECRET_KEY; else process.env.LYRICS_PROVIDER_SECRET_KEY = prev;
  }
});
