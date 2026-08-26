import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEndpoints,
  getNetworkPolicy,
  isMetadataIpv6,
  isPrivateIpv4,
  isPrivateIpv6,
  normalizeProviderBaseUrl,
  validateProviderBaseUrl,
} from './lyrics-provider/policy.ts';
import {
  PROVIDER_DEFAULT_TIMEOUT_MS,
  PROVIDER_MAX_TIMEOUT_MS,
  clampConfiguredTimeoutMs,
  getBudgetConfig,
  resolveProviderTimeoutMs,
} from './lyrics-provider/budget.ts';
import { parseManifest, parseCandidate, searchHttpProvider } from './lyrics-provider/http-client.ts';
import { builtinLyricsProvider, builtinRowIdToKey } from './lyrics-provider/builtin-provider.ts';
import { assertFullOrderedSet } from './lyrics-provider/reorder.ts';
import { MAX_CANDIDATES_PER_PROVIDER } from './lyrics-provider/normalize.ts';
import { normalizeCandidateLyrics } from './lyrics-provider/normalize.ts';
import { hasProviderSecretKey, maskSecret } from './lyrics-provider/secret.ts';
import { isSameOriginRequest } from './admin.ts';

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

test('isPrivateIpv6 detects hex-mapped IPv4 (RFC1918 / link-local / loopback)', () => {
  // WHATWG URL normalises [::ffff:169.254.169.254] → ::ffff:a9fe:a9fe.
  assert.equal(isPrivateIpv6('::ffff:a9fe:a9fe'), true); // 169.254.169.254 link-local
  assert.equal(isPrivateIpv6('::ffff:7f00:1'), true); // 127.0.0.1 loopback
  assert.equal(isPrivateIpv6('::ffff:c0a8:0101'), true); // 192.168.1.1 RFC1918
  assert.equal(isPrivateIpv6('::ffff:0a00:0001'), true); // 10.0.0.1 RFC1918
  // Public hex-mapped stays public.
  assert.equal(isPrivateIpv6('::ffff:0808:0808'), false); // 8.8.8.8
  assert.equal(isPrivateIpv6('::ffff:1.1.1.1'), false); // dotted public
});

test('isMetadataIpv6 rejects IPv4-mapped cloud metadata even in hex form', () => {
  assert.equal(isMetadataIpv6('::ffff:169.254.169.254'), true);
  assert.equal(isMetadataIpv6('::ffff:a9fe:a9fe'), true); // 169.254.169.254 hex
  assert.equal(isMetadataIpv6('::ffff:6464:64c8'), true); // 100.100.100.200 hex (Alibaba metadata)
  assert.equal(isMetadataIpv6('2606:4700::1'), false); // public, not metadata
});

test('validateProviderBaseUrl forbids hex-mapped metadata IPv6 regardless of switches', async () => {
  // Even with private network + http allowed, hex-mapped metadata must be rejected.
  const p = { allowHttp: true, allowPrivateNetwork: true };
  assert.equal(await validateProviderBaseUrl('http://[::ffff:a9fe:a9fe]/latest', p), 'metadata_forbidden');
  assert.equal(await validateProviderBaseUrl('https://[::ffff:169.254.169.254]/', p), 'metadata_forbidden');
  // Private (non-metadata) mapped IPv6 is allowed only when private net is on.
  assert.equal(await validateProviderBaseUrl('https://[::ffff:7f00:1]:8787/', { allowHttp: false, allowPrivateNetwork: true }), null);
  assert.equal(await validateProviderBaseUrl('https://[::ffff:7f00:1]:8787/', { allowHttp: false, allowPrivateNetwork: false }), 'unsafe_host');
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

test('getBudgetConfig applies explicit bounds and fails closed on invalid env', () => {
  const keys = [
    'LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS',
    'LYRICS_PROVIDER_MAX_TIMEOUT_MS',
    'LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS',
    'LYRICS_PROVIDER_CHAIN_TIMEOUT_MS',
  ];
  const prev = keys.map((k) => [k, process.env[k]] as const);
  try {
    // Tightening the ceiling now takes effect (was previously stuck at 60000).
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = '30000';
    assert.equal(getBudgetConfig().maxTimeoutMs, 30000);

    // 1 ms (below min) fails closed to the safe default.
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = '1';
    assert.equal(getBudgetConfig().maxTimeoutMs, PROVIDER_MAX_TIMEOUT_MS);

    // Non-numeric string fails closed.
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = 'abc';
    assert.equal(getBudgetConfig().maxTimeoutMs, PROVIDER_MAX_TIMEOUT_MS);

    // Absurdly large value fails closed.
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = '999999999';
    assert.equal(getBudgetConfig().maxTimeoutMs, PROVIDER_MAX_TIMEOUT_MS);

    // Negative fails closed.
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = '-5';
    assert.equal(getBudgetConfig().maxTimeoutMs, PROVIDER_MAX_TIMEOUT_MS);
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('getBudgetConfig clamps sub-budgets to the max ceiling', () => {
  const keys = [
    'LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS',
    'LYRICS_PROVIDER_MAX_TIMEOUT_MS',
    'LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS',
    'LYRICS_PROVIDER_CHAIN_TIMEOUT_MS',
  ];
  const prev = keys.map((k) => [k, process.env[k]] as const);
  try {
    process.env.LYRICS_PROVIDER_MAX_TIMEOUT_MS = '10000';
    process.env.LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS = '20000'; // above ceiling
    process.env.LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS = '5000';
    const budget = getBudgetConfig();
    assert.equal(budget.maxTimeoutMs, 10000);
    assert.equal(budget.defaultTimeoutMs, 10000); // clamped down to ceiling
    assert.equal(budget.manifestTimeoutMs, 5000);
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
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
  assert.equal(parseCandidate({ title: 't', artists: ['a'], synced_lyrics: '[00:00.00]x' })?.syncedLyrics, '[00:00.00]x');
  // No lyrics at all → dropped.
  assert.equal(parseCandidate({ title: 't', artists: [] }), null);
  // Oversized field → dropped.
  assert.equal(parseCandidate({ title: 't', artists: ['a'], plain_lyrics: 'x'.repeat(200001) }), null);
});

test('parseCandidate rejects missing / blank title and artist identity evidence', () => {
  // Missing title must not inherit the request's title (would score a perfect match).
  assert.equal(parseCandidate({ artists: ['a'], plain_lyrics: 'x' }), null);
  assert.equal(parseCandidate({ title: '   ', artists: ['a'], plain_lyrics: 'x' }), null);
  // Missing / blank artist must not be accepted as identity evidence.
  assert.equal(parseCandidate({ title: 't', plain_lyrics: 'x' }), null);
  assert.equal(parseCandidate({ title: 't', artists: ['', '  '], plain_lyrics: 'x' }), null);
  // Non-string entries are filtered; an empty resulting artist list is rejected.
  assert.equal(parseCandidate({ title: 't', artists: [42], plain_lyrics: 'x' }), null);
  // Whitespace around title/artists is trimmed.
  assert.equal(parseCandidate({ title: '  t  ', artists: ['  a  '], plain_lyrics: 'x' })?.title, 't');
});

// ─── Normalize ────────────────────────────────────────────────

test('normalizeCandidateLyrics decodes entities and derives plain from synced', () => {
  const out = normalizeCandidateLyrics({ syncedLyrics: '[00:01.00]Tom &amp; Jerry', plainLyrics: '' });
  assert.equal(out.plain, 'Tom & Jerry');
  assert.equal(out.synced, '[00:01.00]Tom & Jerry');
  assert.equal(out.syncedValid, true);
});

test('normalizeCandidateLyrics downgrades synced with no valid LRC timeline to plain', () => {
  // Plain text masquerading as synced (no timestamps) → synced is dropped.
  const plainOnly = normalizeCandidateLyrics({ syncedLyrics: 'just plain text, no timestamps', plainLyrics: '' });
  assert.equal(plainOnly.synced, '');
  assert.equal(plainOnly.syncedValid, false);
  // A real timed LRC keeps the timeline and flags syncedValid.
  const timed = normalizeCandidateLyrics({ syncedLyrics: '[00:01.00]Tom &amp; Jerry\n[00:04.00]says hi', plainLyrics: '' });
  assert.equal(timed.syncedValid, true);
  assert.match(timed.plain, /Tom & Jerry/);
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

// ─── HTTP search cancellation propagation ─────────────────────

test('searchHttpProvider propagates caller cancellation instead of mapping to timeout', async () => {
  const originalFetch = globalThis.fetch as unknown;
  // A fetch that never settles on its own — only the abort signal can end it.
  globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;
  const controller = new AbortController();
  try {
    const promise = searchHttpProvider(
      { baseUrl: 'https://8.8.8.8/x', authType: 'none', timeoutMs: 50 },
      { title: 't', artists: ['a'] },
      50,
      'req-id',
      controller.signal,
    );
    // Abort the caller — must reject (propagate) rather than return a `timeout` outcome.
    controller.abort();
    await assert.rejects(promise, (err: unknown) =>
      err instanceof Error && err.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch as typeof fetch;
  }
});

test('searchHttpProvider returns a timeout outcome on provider timeout without caller cancel', async () => {
  const originalFetch = globalThis.fetch as unknown;
  // Never settles on its own, but honours the provider timeout's abort signal.
  globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;
  try {
    const outcome = await searchHttpProvider(
      { baseUrl: 'https://8.8.8.8/x', authType: 'none', timeoutMs: 20 },
      { title: 't', artists: ['a'] },
      20,
      'req-id',
    );
    assert.equal(outcome.status, 'timeout');
  } finally {
    globalThis.fetch = originalFetch as typeof fetch;
  }
});

test('searchHttpProvider maps HTTP 200 with an empty candidate list to empty, not hit', async () => {
  const originalFetch = globalThis.fetch as unknown;
  globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) => {
    assert.ok(init?.signal, 'fetch should be wired to an abort signal');
    const body = JSON.stringify({ protocol_version: 1, candidates: [] });
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const outcome = await searchHttpProvider(
      { baseUrl: 'https://8.8.8.8/x', authType: 'none', timeoutMs: 500 },
      { title: 't', artists: ['a'] },
      500,
      'req-id',
    );
    // An empty result set must be surfaced as `empty` so diagnostics can tell a
    // normal no-match apart from a real hit.
    assert.equal(outcome.status, 'empty');
    assert.deepEqual(outcome.candidates, []);
  } finally {
    globalThis.fetch = originalFetch as typeof fetch;
  }
});

test('searchHttpProvider keeps a non-empty candidate list as a hit', async () => {
  const originalFetch = globalThis.fetch as unknown;
  const body = JSON.stringify({
    protocol_version: 1,
    candidates: [{ title: 'Same Song', artists: ['Artist'], plain_lyrics: 'line' }],
  });
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response)) as typeof fetch;
  try {
    const outcome = await searchHttpProvider(
      { baseUrl: 'https://8.8.8.8/x', authType: 'none', timeoutMs: 500 },
      { title: 'Same Song', artists: ['Artist'] },
      500,
      'req-id',
    );
    assert.equal(outcome.status, 'hit');
    assert.equal(outcome.candidates.length, 1);
  } finally {
    globalThis.fetch = originalFetch as typeof fetch;
  }
});

// ─── Admin CSRF / Origin guard ────────────────────────────────

test('isSameOriginRequest rejects mismatched Origin and allows same-origin / missing', () => {
  const req = (origin: string | null, host = 'app.example.com') => ({
    headers: { get: (name: string) => (name === 'Origin' ? origin : name === 'Host' ? host : null) },
    nextUrl: { host },
  });
  // Allowed: matching Origin host.
  assert.equal(isSameOriginRequest(req('https://app.example.com')), true);
  assert.equal(isSameOriginRequest(req('http://app.example.com')), true); // scheme ignored
  // Allowed: missing Origin (non-browser / server-to-server).
  assert.equal(isSameOriginRequest(req(null)), true);
  // Rejected: cross-origin / different sibling site.
  assert.equal(isSameOriginRequest(req('https://evil.example.net')), false);
  assert.equal(isSameOriginRequest(req('https://app.example.com.evil.net')), false);
  // Rejected: malformed Origin.
  assert.equal(isSameOriginRequest(req('not a url')), false);
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

// ─── reorderProviders: full-set validation ────────────────────

test('assertFullOrderedSet rejects a partial ordered list that does not cover every provider', () => {
  // Only p1 supplied → the set is incomplete.
  assert.throws(() => assertFullOrderedSet(['p1', 'p2'], ['p1']), /every provider id exactly once/);
});

test('assertFullOrderedSet rejects duplicate ids in the ordered list', () => {
  assert.throws(() => assertFullOrderedSet(['p1', 'p2'], ['p1', 'p1']), /every provider id exactly once/);
});

test('assertFullOrderedSet rejects unknown ids not present in the stored set', () => {
  assert.throws(() => assertFullOrderedSet(['p1', 'p2'], ['p1', 'p3']), /every provider id exactly once/);
});

test('assertFullOrderedSet accepts a full ordered list', () => {
  // Full set, any order, no duplicates → valid.
  assert.doesNotThrow(() => assertFullOrderedSet(['p1', 'p2'], ['p2', 'p1']));
});

// ─── Builtin provider: Uta-Net adapter resolves a hit through the shared chain ──

test('builtinLyricsProvider(uta-net row) returns a pre-scored Uta-Net hit', async () => {
  const originalFetch = globalThis.fetch as unknown;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('uta-net.com/search')) {
      const html = `<table><tr>
        <td><a href="/song/123/" class="d-block">Same Song</a></td>
        <td><a href="/artist/1/">Artist</a></td>
      </tr></table>`;
      return { ok: true, status: 200, text: async () => html } as unknown as Response;
    }
    if (url.includes('uta-net.com/song/')) {
      const html = `<div id="kashi_area">Line 1<br/>Line 2</div>`;
      return { ok: true, status: 200, text: async () => html } as unknown as Response;
    }
    // PetitLyrics / anything else → miss.
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
  }) as typeof fetch;
  try {
    const provider = builtinLyricsProvider({ id: 'builtin:uta-net', name: 'Uta-Net' });
    const outcome = await provider.search({ title: 'Same Song', artists: ['Artist'] }, {});
    assert.equal(outcome.status, 'hit');
    assert.equal(outcome.candidates.length, 1);
    assert.equal(outcome.candidates[0]?.candidateId, 'uta-net');
    // Pre-scored confidence from the same evidence pipeline as before.
    assert.equal(typeof outcome.candidates[0]?.confidence, 'number');
  } finally {
    globalThis.fetch = originalFetch as typeof fetch;
  }
});

test('builtinRowIdToKey resolves both colon and legacy hyphen row ids', () => {
  assert.equal(builtinRowIdToKey('builtin:uta-net'), 'uta-net');
  assert.equal(builtinRowIdToKey('builtin-uta-net'), 'uta-net');
  assert.equal(builtinRowIdToKey('builtin-lrclib'), 'lrclib');
  assert.equal(builtinRowIdToKey('builtin-ytmusic'), 'ytmusic');
  assert.equal(builtinRowIdToKey('plugin:abc:1'), null);
  assert.equal(builtinRowIdToKey('builtin-unknown'), null);
});
