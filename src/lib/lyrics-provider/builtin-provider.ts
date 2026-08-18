/**
 * Builtin lyrics source adapter (ISSUE #148, Phase 1 unified abstraction).
 *
 * Wraps the legacy single-body builtin chain (LRCLIB → PetitLyrics → Uta-Net →
 * ytmusic) behind the same `LyricsProvider` contract used by runtime HTTP
 * plugins, so both classes of sources flow through one shared orchestrator
 * loop. The builtin chain keeps its exact default order + confidence rules for
 * full backward compatibility: candidates carry a pre-scored `confidence` and
 * the orchestrator accepts them directly instead of re-scoring.
 */
import type { LyricsProvider, LyricsProviderQuery, ProviderContext, ProviderOutcome } from './types.ts';
import { fetchLyrics, syncStageToDynamicProviderStage, type SyncStage } from '../lyrics-fetcher.ts';

/** Stable source identifier prefix used for builtin provider stage ids. */
export const BUILTIN_SOURCE_ID = 'builtin';

/** Adapter that presents the builtin chain as a single `LyricsProvider`. */
export function builtinLyricsProvider(opts?: {
  spotifyCanonical?: { name: string; artist: string } | null;
  spotify?: { durationMs?: number; album?: string };
}): LyricsProvider {
  return {
    id: BUILTIN_SOURCE_ID,
    displayName: 'Builtin',
    kind: 'builtin',
    async search(query: LyricsProviderQuery, context: ProviderContext): Promise<ProviderOutcome> {
      const res = await fetchLyrics(query.title, query.artists[0] ?? '', {
        spotifyCanonical: opts?.spotifyCanonical,
        spotify: opts?.spotify,
        signal: context.signal,
        // Bridge the legacy builtin string stages to the dynamic ProviderStage
        // contract used by the unified orchestrator loop.
        onStage: (s) => {
          if (typeof s === 'object') {
            context.onStage?.(s);
          } else {
            context.onStage?.(syncStageToDynamicProviderStage(s as SyncStage));
          }
        },
      });
      if (!res.result) {
        return {
          status: 'empty',
          candidates: [],
          ...(res.rateLimited ? { rateLimited: true } : {}),
        };
      }
      return {
        status: 'hit',
        candidates: [
          {
            // Keep the legacy builtin source key (e.g. `lrclib`, `uta-net`) so
            // downstream source labels and diagnostics stay backward compatible.
            candidateId: res.source,
            title: query.title,
            artists: query.artists,
            plainLyrics: res.result.plain || undefined,
            syncedLyrics: res.result.synced || undefined,
            confidence: res.confidence,
            match: res.match,
            rateLimited: res.rateLimited,
            durationMismatch: res.durationMismatch,
          },
        ],
      };
    },
  };
}
