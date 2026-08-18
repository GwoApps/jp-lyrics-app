/**
 * Effective provider chain orchestrator (ISSUE #148).
 *
 * The builtin chain (LRCLIB → PetitLyrics → Uta-Net → ytmusic) runs first and
 * keeps its exact order + confidence rules (backward compatible). When the
 * builtin chain finds nothing, the admin-enabled HTTP providers are consulted
 * in priority order. Every HTTP candidate is re-scored by jplrc using the same
 * title/artist/duration/album evidence pipeline — provider-reported confidence
 * is never trusted.
 *
 * The whole effective chain is bounded by the deployment chain budget, and the
 * caller's AbortSignal (user cancel) always takes precedence over any timeout.
 */
import { artistScore, titleScore } from '../match.ts';
import { fetchLyrics, type LyricsFetchResult, durationStatus, albumStatus } from '../lyrics-fetcher.ts';
import type { LyricsProviderQuery, ProviderStage } from './types.ts';
import { getBudgetConfig, resolveProviderTimeoutMs, isAbortError } from './budget.ts';
import { listEffectiveProviders } from './config.ts';
import { searchHttpProvider } from './http-client.ts';
import { decryptProviderSecret } from './secret.ts';
import { normalizeCandidateLyrics } from './normalize.ts';
import { getDB } from '../db.ts';

export interface ProviderChainOptions {
  spotifyCanonical?: { name: string; artist: string } | null;
  spotify?: { durationMs?: number; album?: string };
  onStage?: ProviderChainOnStage;
  signal?: AbortSignal;
}

/** Accept either the legacy SyncStage string or a dynamic provider stage. */
export type SyncStageOrDynamic = string | ProviderStage;

/** The onStage callback the chain invokes; legacy builtin strings or dynamic objects. */
export type ProviderChainOnStage = (stage: SyncStageOrDynamic) => void;

/**
 * Score a candidate and decide its confidence + review classification, mirroring
 * the builtin chain's evidence-based rules so HTTP providers get the same
 * quality gate. Returns the final LyricsFetchResult (or null when rejected).
 */
function scoreCandidate(
  query: LyricsProviderQuery,
  evidence: { durationMs?: number; album?: string } | undefined,
  candidate: { title: string; artists: string[]; plain?: string; synced?: string; durationMs?: number; album?: string },
  source: string,
): LyricsFetchResult | null {
  const hasRequestedArtist = query.artists.some((a) => a.trim().length > 0);
  const tScore = titleScore(query.title, candidate.title || query.title);
  const aScore = hasRequestedArtist
    ? Math.max(...query.artists.map((a) => artistScore(a, candidate.artists[0] ?? '')))
    : 0.5;
  if (tScore < 0.55) return null;
  if (hasRequestedArtist && (!candidate.artists[0] || aScore < 0.55)) return null;

  // Duration conflict → a different recording; drop outright (same as LRCLIB).
  const duration = durationStatus(
    candidate.durationMs != null ? candidate.durationMs / 1000 : null,
    evidence?.durationMs,
  );
  if (duration === 'conflict') return null;

  let score = tScore * 0.7 + aScore * 0.3;
  if (duration === 'match') score += 0.05;
  else if (duration === 'close') score -= 0.04;
  const album = albumStatus(candidate.album, evidence?.album);
  if (album === 'match') score += 0.03;
  else if (album === 'partial') score += 0.01;

  const synced = !!(candidate.synced && candidate.synced.trim());
  const confidence = Math.round(40 + score * 50);
  // Reuse the same base confidence mapping as Uta-Net (plain/synced-aware).
  const finalConfidence = synced ? Math.min(90, confidence) : Math.min(82, confidence);
  const isPlainHit = !candidate.synced?.trim();
  const result = normalizeCandidateLyrics({
    plainLyrics: candidate.plain || (candidate.synced ? '' : candidate.plain),
    syncedLyrics: candidate.synced,
  });

  // Fall below the hard floor → wrong candidate; never persist silently.
  if (finalConfidence < 60) return null;

  const match = candidate.title || candidate.artists[0]
    ? { title: candidate.title || query.title, artist: candidate.artists[0] || '', link: '' }
    : undefined;

  return {
    result,
    source,
    confidence: finalConfidence,
    durationMismatch: false, // conflict candidates are already dropped above
    ...(match && !isPlainHit ? { match } : {}),
  };
}

/**
 * Build the effective chain and fetch lyrics. Backward compatible: with no HTTP
 * providers configured, behaviour is byte-for-byte identical to `fetchLyrics`.
 */
export async function fetchLyricsWithChain(
  title: string,
  artist: string,
  opts?: ProviderChainOptions,
): Promise<LyricsFetchResult> {
  const chainBudget = getBudgetConfig();
  const chainController = new AbortController();
  const onChainAbort = () => chainController.abort();
  opts?.signal?.addEventListener('abort', onChainAbort, { once: true });
  const chainTimer = setTimeout(() => chainController.abort(), chainBudget.chainTimeoutMs);

  // Compose the caller's signal with the chain budget signal.
  const combinedSignal = opts?.signal
    ? AbortSignal.any([opts.signal, chainController.signal])
    : chainController.signal;

  const emitStage = (stage: string | ProviderStage) => opts?.onStage?.(stage);

  const query: LyricsProviderQuery = {
    title,
    artists: artist ? [artist] : [],
    album: opts?.spotify?.album,
    durationMs: opts?.spotify?.durationMs,
    spotifyTrackId: opts?.spotifyCanonical?.name ? undefined : undefined,
  };

  try {
    // 1. Builtin chain first (preserves default order + confidence exactly).
    const builtin = await fetchLyrics(title, artist, {
      spotifyCanonical: opts?.spotifyCanonical,
      spotify: opts?.spotify,
      signal: combinedSignal,
      onStage: (s) => emitStage(s),
    });
    if (builtin.result) return builtin;

    // 2. HTTP providers (only reached when builtin found nothing).
    const db = getDB();
    const httpProviders = await listEffectiveProviders(db);
    if (httpProviders.length === 0) {
      return builtin; // no plugin → identical legacy result
    }

    for (const cfg of httpProviders) {
      if (combinedSignal.aborted) {
        if (opts?.signal?.aborted) throw opts.signal.reason;
        break;
      }
      const providerStage: ProviderStage = {
        id: `plugin:${cfg.id}:${cfg.protocolVersion}`,
        displayName: cfg.name,
        kind: 'http',
      };
      emitStage(providerStage);

      const timeoutMs = resolveProviderTimeoutMs(cfg.timeoutMs, chainBudget);
      const authSecret = cfg.authType === 'bearer' && cfg.authSecretCiphertext
        ? await decryptProviderSecret(cfg.authSecretCiphertext)
        : null;
      const outcome = await searchHttpProvider(
        {
          baseUrl: cfg.baseUrl,
          authType: cfg.authType,
          authSecret,
          timeoutMs,
        },
        query,
        timeoutMs,
        crypto.randomUUID(),
      );

      if (outcome.status !== 'hit') continue; // fall through on every non-hit status

      // Re-score every candidate; take the best accepted one.
      let best: LyricsFetchResult | null = null;
      for (const candidate of outcome.candidates) {
        const scored = scoreCandidate(
          query,
          opts?.spotify,
          {
            title: candidate.title,
            artists: candidate.artists,
            plain: candidate.plainLyrics,
            synced: candidate.syncedLyrics,
            durationMs: candidate.durationMs,
            album: candidate.album,
          },
          `plugin:${cfg.id}:${cfg.protocolVersion}`,
        );
        if (scored && (!best || scored.confidence > best.confidence)) {
          best = scored;
        }
      }
      if (best) return best;
    }

    // Nothing from HTTP providers either → return the builtin miss (or rate-limit).
    return builtin;
  } catch (err) {
    if (isAbortError(err)) {
      // Chain budget expired without a caller cancel → report a soft timeout.
      if (!opts?.signal?.aborted) {
        return { result: null, source: '', confidence: 0, rateLimited: false };
      }
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(chainTimer);
    opts?.signal?.removeEventListener('abort', onChainAbort);
  }
}

/** Stable source identifier → display name for UI (config/manifest-driven). */
export function providerDisplayName(source: string): string | null {
  const m = /^plugin:([^:]+):\d+$/.exec(source);
  if (!m) return null;
  return m[1]; // config id; caller maps to the provider's configured name.
}
