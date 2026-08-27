/**
 * Builtin lyrics source adapters (ISSUE #148, unified abstraction).
 *
 * Each trusted builtin source (LRCLIB → PetitLyrics → Uta-Net → ytmusic) is
 * exposed as an individual `LyricsProvider` backed by a `builtin:*` row in
 * `lyrics_provider_configs`, so admins can enable/disable and reorder them in
 * the same 歌词源 panel as runtime HTTP plugins. The legacy behaviour (default
 * order, confidence rules, source labels such as `lrclib` / `uta-net`) is
 * preserved by the seed migration + the per-source search functions below.
 */
import type { LyricsProvider, LyricsProviderQuery, ProviderContext, ProviderOutcome } from './types.ts';
import { validateProviderBaseUrl, getNetworkPolicy } from './policy.ts';
import {
  fetchFromLrclib,
  searchLrclib,
  fetchFromPetitLyrics,
  fetchFromUtaNet,
  fetchFromYtMusic,
  lrclibConfidence,
  utaNetConfidence,
} from '../lyrics-fetcher.ts';

/** Stable row ids used by the seed migration — never rename these. */
export const BUILTIN_PROVIDER_IDS = ['builtin:lrclib', 'builtin:petitlyrics', 'builtin:uta-net', 'builtin:ytmusic'] as const;
export type BuiltinSourceKey = 'lrclib' | 'petitlyrics' | 'uta-net' | 'ytmusic';

/**
 * Row id (`builtin:<key>`) → legacy source key kept for display/diagnostics.
 *
 * Accepts the historical `builtin-<key>` (hyphen) form too: an earlier internal
 * build seeded production rows with hyphen ids before the scheme settled on
 * colons, so both spellings must resolve to the same adapter.
 */
export function builtinRowIdToKey(rowId: string): BuiltinSourceKey | null {
  const match = /^builtin[:-](.+)$/.exec(rowId);
  if (!match) return null;
  switch (match[1]) {
    case 'lrclib': return 'lrclib';
    case 'petitlyrics': return 'petitlyrics';
    case 'uta-net': return 'uta-net';
    case 'ytmusic': return 'ytmusic';
    default: return null;
  }
}

/** Display names shown in the admin panel / SSE stage for each builtin source. */
export function builtinSourceDisplayName(key: BuiltinSourceKey): string {
  switch (key) {
    case 'lrclib': return 'LRCLIB';
    case 'petitlyrics': return 'PetitLyrics';
    case 'uta-net': return 'Uta-Net';
    case 'ytmusic': return 'YouTube Music';
  }
}

/**
 * Per-source config extracted from `source_config` JSON on a builtin row.
 * Each source defines its own fields through the provider API schema
 * (src/lib/lyrics-provider/api-schema.ts).
 */
export interface BuiltinSourceConfig {
  // LRCLIB
  rateLimitMs?: number;
  apiBase?: string;
  fuzzyEnabled?: boolean;
  // PetitLyrics
  syncCandidateLimit?: number;
  // ytmusic
  sidecarUrl?: string;
  // shared
  timeoutMs?: number;
}

/** Parse a `source_config` JSON string into typed per-source fields. */
export function parseSourceConfig(raw: string | null): BuiltinSourceConfig {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: BuiltinSourceConfig = {};
    if (typeof obj.rate_limit_ms === 'number') out.rateLimitMs = obj.rate_limit_ms;
    if (typeof obj.api_base === 'string') out.apiBase = obj.api_base;
    if (typeof obj.fuzzy_enabled === 'boolean') out.fuzzyEnabled = obj.fuzzy_enabled;
    if (typeof obj.sync_candidate_limit === 'number') out.syncCandidateLimit = obj.sync_candidate_limit;
    if (typeof obj.sidecar_url === 'string') out.sidecarUrl = obj.sidecar_url;
    return out;
  } catch {
    return {};
  }
}

/** Build the `LyricsProvider` adapter for one stored builtin provider row. */
export function builtinLyricsProvider(cfg: { id: string; name: string; timeoutMs?: number | null; sourceConfig?: string | null }): LyricsProvider {
  const key = builtinRowIdToKey(cfg.id);
  if (!key) throw new Error(`unknown builtin provider id: ${cfg.id}`);
  const sourceConfig = parseSourceConfig(cfg.sourceConfig ?? null);
  const resolvedTimeoutMs = cfg.timeoutMs ?? undefined;
  return {
    id: cfg.id,
    displayName: cfg.name || builtinSourceDisplayName(key),
    kind: 'builtin',
    async search(query: LyricsProviderQuery, context: ProviderContext): Promise<ProviderOutcome> {
      context.onStage?.({ id: cfg.id, displayName: cfg.name || builtinSourceDisplayName(key), kind: 'builtin' });
      const artist = query.artists[0] ?? '';

      // Row-level timeout: when the admin configures a timeout override, it
      // bounds the ENTIRE adapter execution (all internal requests combined),
      // not just each individual HTTP request. Create an AbortController whose
      // deadline is the configured timeout and compose it with the caller's
      // signal so every internal fetch honours both.
      let rowController: AbortController | null = null;
      let rowTimer: ReturnType<typeof setTimeout> | null = null;
      let signal = context.signal;
      if (resolvedTimeoutMs != null && resolvedTimeoutMs > 0) {
        rowController = new AbortController();
        rowTimer = setTimeout(() => rowController!.abort(), resolvedTimeoutMs);
        signal = context.signal
          ? AbortSignal.any([context.signal, rowController.signal])
          : rowController.signal;
      }
      // Runtime SSRF defence: URL overrides from source_config are validated
      // against the deployment policy on EVERY search, in case the env policy
      // changed after the value was persisted (defence-in-depth alongside the
      // persistence-time check in api-schema.ts).
      if (sourceConfig.apiBase) {
        const policyError = await validateProviderBaseUrl(sourceConfig.apiBase, getNetworkPolicy());
        if (policyError) {
          return { status: 'error', candidates: [], diagnostic: policyError };
        }
      }
      if (sourceConfig.sidecarUrl) {
        const policyError = await validateProviderBaseUrl(sourceConfig.sidecarUrl, getNetworkPolicy());
        if (policyError) {
          return { status: 'error', candidates: [], diagnostic: policyError };
        }
      }

      try {
        switch (key) {
          case 'lrclib':
            // Per-request timeout stays at its source default; the row-level
            // AbortController bounds the total elapsed time across all stages.
            return await searchBuiltinLrclib(query, signal, {
              rateLimitMs: sourceConfig.rateLimitMs,
              apiBase: sourceConfig.apiBase,
              fuzzyEnabled: sourceConfig.fuzzyEnabled,
            });
          case 'petitlyrics': {
            const pl = await fetchFromPetitLyrics(query.title, artist, signal, {
              syncCandidateLimit: sourceConfig.syncCandidateLimit,
            });
            if (!pl || (!pl.synced && !pl.plain)) return { status: 'empty', candidates: [] };
            return {
              status: 'hit',
              candidates: [{
                candidateId: 'petitlyrics',
                title: query.title,
                artists: query.artists,
                plainLyrics: pl.plain || undefined,
                syncedLyrics: pl.synced || undefined,
                confidence: pl.synced ? 90 : 82,
              }],
            };
          }
          case 'uta-net': {
            const un = await fetchFromUtaNet(query.title, artist, signal, {});
            if (!un) return { status: 'empty', candidates: [] };
            return {
              status: 'hit',
              candidates: [{
                candidateId: 'uta-net',
                title: query.title,
                artists: query.artists,
                plainLyrics: un.result.plain || undefined,
                syncedLyrics: un.result.synced || undefined,
                confidence: utaNetConfidence(un.score),
                match: { title: un.matchedTitle, artist: un.matchedArtist, link: un.link, ambiguous: un.ambiguous },
              }],
            };
          }
          case 'ytmusic': {
            const yt = await fetchFromYtMusic(query.title, artist, signal, {
              sidecarUrl: sourceConfig.sidecarUrl,
            });
            if (!yt) return { status: 'empty', candidates: [] };
            return {
              status: 'hit',
              candidates: [{
                candidateId: 'ytmusic',
                title: query.title,
                artists: query.artists,
                plainLyrics: yt.plain || undefined,
                syncedLyrics: yt.synced || undefined,
                confidence: yt.synced ? 74 : 68,
              }],
            };
          }
        }
      } catch (err) {
        // Caller cancel must keep propagating (orchestrator rethrows it).
        if (context.signal?.aborted) throw context.signal.reason ?? err;
        // Row-level timeout fired → return a soft error instead of throwing.
        if (rowController?.signal.aborted) return { status: 'error', candidates: [], diagnostic: 'timeout' };
        return { status: 'error', candidates: [], diagnostic: err instanceof Error ? err.message.slice(0, 200) : 'error' };
      } finally {
        if (rowTimer) clearTimeout(rowTimer);
      }
    },
  };
}

/** LRCLIB exact → Spotify canonical exact/fuzzy → fuzzy search, mirroring the legacy chain. */
async function searchBuiltinLrclib(
  query: LyricsProviderQuery,
  signal?: AbortSignal,
  opts?: {
    rateLimitMs?: number;
    apiBase?: string;
    fuzzyEnabled?: boolean;
  },
): Promise<ProviderOutcome> {
  const evidence = query.durationMs != null || query.album != null
    ? { durationMs: query.durationMs, album: query.album }
    : undefined;
  const lrclibOpts = opts ? {
    rateLimitMs: opts.rateLimitMs,
    apiBase: opts.apiBase,
    fuzzyEnabled: opts.fuzzyEnabled,
  } : undefined;
  let rateLimited = false;

  let outcome = await fetchFromLrclib(query.title, query.artists[0] ?? '', evidence, signal, lrclibOpts);
  rateLimited = rateLimited || outcome.rateLimited;
  if (outcome.hit) {
    return lrclibHitOutcome(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 98, true));
  }

  // Fuzzy stage is skippable — exact match is faster and avoids extra requests
  // to rate-limited public endpoints.
  const fuzzy = opts?.fuzzyEnabled ?? true;

  if (query.spotifyCanonical) {
    outcome = await fetchFromLrclib(query.spotifyCanonical.name, query.spotifyCanonical.artist, evidence, signal, lrclibOpts);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) {
      return lrclibHitOutcome(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 96, true));
    }
    if (fuzzy) {
      outcome = await searchLrclib(`${query.spotifyCanonical.name} ${query.spotifyCanonical.artist}`, query.spotifyCanonical.name, query.spotifyCanonical.artist, evidence, signal, lrclibOpts);
      rateLimited = rateLimited || outcome.rateLimited;
      if (outcome.hit) {
        return lrclibHitOutcome(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 82, false));
      }
    }
  }

  if (fuzzy) {
    outcome = await searchLrclib(`${query.title} ${query.artists[0] ?? ''}`, query.title, query.artists[0] ?? '', evidence, signal, lrclibOpts);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) {
      return lrclibHitOutcome(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 78, false));
    }
  }

  return { status: 'empty', candidates: [], ...(rateLimited ? { rateLimited: true } : {}) };
}

function lrclibHitOutcome(
  result: { synced: string; plain: string },
  candidateId: string,
  confidence: number,
): ProviderOutcome {
  return {
    status: 'hit',
    candidates: [{
      candidateId,
      // Title/artists are echoed back as requested; LRCLIB evidence was already
      // applied to the pre-scored confidence above.
      title: '',
      artists: [],
      plainLyrics: result.plain || undefined,
      syncedLyrics: result.synced || undefined,
      confidence,
    }],
  };
}
