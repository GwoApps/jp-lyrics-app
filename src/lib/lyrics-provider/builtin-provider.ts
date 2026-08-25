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

/** Row id (`builtin:<key>`) → legacy source key kept for display/diagnostics. */
export function builtinRowIdToKey(rowId: string): BuiltinSourceKey | null {
  switch (rowId) {
    case 'builtin:lrclib': return 'lrclib';
    case 'builtin:petitlyrics': return 'petitlyrics';
    case 'builtin:uta-net': return 'uta-net';
    case 'builtin:ytmusic': return 'ytmusic';
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

/** Build the `LyricsProvider` adapter for one stored builtin provider row. */
export function builtinLyricsProvider(cfg: { id: string; name: string; timeoutMs?: number | null }): LyricsProvider {
  const key = builtinRowIdToKey(cfg.id);
  if (!key) throw new Error(`unknown builtin provider id: ${cfg.id}`);
  return {
    id: cfg.id,
    displayName: cfg.name || builtinSourceDisplayName(key),
    kind: 'builtin',
    async search(query: LyricsProviderQuery, context: ProviderContext): Promise<ProviderOutcome> {
      context.onStage?.({ id: cfg.id, displayName: cfg.name || builtinSourceDisplayName(key), kind: 'builtin' });
      const signal = context.signal;
      const artist = query.artists[0] ?? '';
      try {
        switch (key) {
          case 'lrclib':
            return await searchBuiltinLrclib(query, signal);
          case 'petitlyrics': {
            const pl = await fetchFromPetitLyrics(query.title, artist, signal);
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
            const un = await fetchFromUtaNet(query.title, artist, signal);
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
            const yt = await fetchFromYtMusic(query.title, artist, signal);
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
        if (signal?.aborted) throw signal.reason ?? err;
        return { status: 'error', candidates: [], diagnostic: err instanceof Error ? err.message.slice(0, 200) : 'error' };
      }
    },
  };
}

/** LRCLIB exact → Spotify canonical exact/fuzzy → fuzzy search, mirroring the legacy chain. */
async function searchBuiltinLrclib(
  query: LyricsProviderQuery,
  signal?: AbortSignal,
): Promise<ProviderOutcome> {
  const evidence = query.durationMs != null || query.album != null
    ? { durationMs: query.durationMs, album: query.album }
    : undefined;
  let rateLimited = false;

  let outcome = await fetchFromLrclib(query.title, query.artists[0] ?? '', evidence, signal);
  rateLimited = rateLimited || outcome.rateLimited;
  if (outcome.hit) {
    return lrclibHitOutcome(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 98, true));
  }

  if (query.spotifyCanonical) {
    outcome = await fetchFromLrclib(query.spotifyCanonical.name, query.spotifyCanonical.artist, evidence, signal);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) {
      return lrclibHitOutcome(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 96, true));
    }
    outcome = await searchLrclib(`${query.spotifyCanonical.name} ${query.spotifyCanonical.artist}`, query.spotifyCanonical.name, query.spotifyCanonical.artist, evidence, signal);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) {
      return lrclibHitOutcome(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 82, false));
    }
  }

  outcome = await searchLrclib(`${query.title} ${query.artists[0] ?? ''}`, query.title, query.artists[0] ?? '', evidence, signal);
  rateLimited = rateLimited || outcome.rateLimited;
  if (outcome.hit) {
    return lrclibHitOutcome(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 78, false));
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
