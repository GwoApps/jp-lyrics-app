/**
 * Effective provider chain orchestrator (ISSUE #148).
 *
 * Phase 1 unified abstraction: builtin sources (LRCLIB → PetitLyrics → Uta-Net
 * → ytmusic) and admin-enabled HTTP providers are all exposed as `LyricsProvider`
 * adapters and scheduled by a single orchestrator loop, sharing the caller's
 * AbortSignal and the chain budget. The builtin adapter keeps its exact order +
 * confidence rules (backward compatible) and sits first; HTTP providers follow
 * by priority. Every HTTP candidate is re-scored by jplrc using the same
 * title/artist/duration/album evidence pipeline — provider-reported confidence
 * is never trusted.
 *
 * The whole effective chain is bounded by the deployment chain budget, and the
 * caller's AbortSignal (user cancel) always takes precedence over any timeout.
 */
import { artistScore, titleScore } from '../match.ts';
import { type LyricsFetchResult, durationStatus, albumStatus } from '../lyrics-fetcher.ts';
import type { LyricsProvider, LyricsProviderQuery, ProviderStage } from './types.ts';
import { builtinLyricsProvider } from './builtin-provider.ts';
import { httpLyricsProvider } from './http-provider.ts';
import { getBudgetConfig, resolveProviderTimeoutMs, isAbortError } from './budget.ts';
import { listEffectiveProviders } from './config.ts';
import { decryptProviderSecret } from './secret.ts';
import { normalizeCandidateLyrics } from './normalize.ts';
import { getDB } from '../db.ts';

export interface ProviderChainOptions {
  spotifyCanonical?: { name: string; artist: string } | null;
  spotify?: { durationMs?: number; album?: string };
  /** Spotify track id forwarded to HTTP providers (also used by the builtin LRCLIB bridge when present). */
  spotifyTrackId?: string | null;
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

  const result = normalizeCandidateLyrics({
    plainLyrics: candidate.plain || (candidate.synced ? '' : candidate.plain),
    syncedLyrics: candidate.synced,
  });
  // A candidate is a timed hit only when its synced payload actually carries a
  // valid LRC timeline (malformed / plain-only synced is downgraded to plain).
  const synced = result.syncedValid;
  if (!synced && !result.plain.trim()) return null; // no usable lyrics at all
  const confidence = Math.round(40 + score * 50);
  // Reuse the same base confidence mapping as Uta-Net (plain/synced-aware).
  const finalConfidence = synced ? Math.min(90, confidence) : Math.min(82, confidence);
  const isPlainHit = !synced;

  // Fall below the hard floor → wrong candidate; never persist silently.
  if (finalConfidence < 60) return null;

  // Never substitute the request's title/artist as if it were candidate
  // evidence — `parseCandidate` guarantees non-empty identity fields for HTTP
  // candidates, so a missing title here is treated as no trusted match.
  const match = candidate.title && candidate.artists[0]
    ? { title: candidate.title, artist: candidate.artists[0], link: '' }
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
    spotifyTrackId: opts?.spotifyTrackId ?? undefined,
  };

  // Unified provider chain (Phase 1 abstraction): the builtin chain is exposed
  // as a `LyricsProvider` (pre-scored confidence, backward compatible) and sits
  // first so its default order + confidence rules are preserved; runtime HTTP
  // providers follow by their configured priority. Every source is scheduled by
  // the same loop and shares the caller's cancel signal.
  try {
    const db = getDB();
    const httpProviders = await listEffectiveProviders(db);

    // Build the unified provider chain: builtin first (backward compatible),
    // then each enabled HTTP provider with its decrypted secret + timeout.
    const providers: LyricsProvider[] = [
      builtinLyricsProvider({
        spotifyCanonical: opts?.spotifyCanonical,
        spotify: opts?.spotify,
      }),
    ];
    for (const cfg of httpProviders) {
      const authSecret = cfg.authType === 'bearer' && cfg.authSecretCiphertext
        ? await decryptProviderSecret(cfg.authSecretCiphertext)
        : null;
      providers.push(httpLyricsProvider(
        cfg,
        authSecret,
        resolveProviderTimeoutMs(cfg.timeoutMs, chainBudget),
      ));
    }

    let best: LyricsFetchResult | null = null;
    let rateLimited = false;

    for (const provider of providers) {
      if (combinedSignal.aborted) {
        if (opts?.signal?.aborted) throw opts.signal.reason;
        break;
      }

      // The provider's own search() emits its stage via onStage (dynamic stage
      // objects for both builtin bridges and HTTP plugins); nothing else needed.
      const outcome = await provider.search(query, { signal: combinedSignal, onStage: emitStage });
      rateLimited = rateLimited || !!outcome.rateLimited;
      if (outcome.status !== 'hit') continue;

      for (const candidate of outcome.candidates) {
        // Builtin candidates carry a pre-scored confidence and are accepted
        // directly; HTTP candidates are scored by the shared evidence pipeline.
        let scored: LyricsFetchResult | null;
        if (typeof candidate.confidence === 'number') {
          scored = {
            result: {
              plain: candidate.plainLyrics ?? '',
              synced: candidate.syncedLyrics ?? '',
            },
            source: candidate.candidateId ?? provider.id,
            confidence: candidate.confidence,
            ...(candidate.durationMismatch ? { durationMismatch: true } : {}),
            ...(candidate.match ? { match: candidate.match } : {}),
          };
        } else {
          scored = scoreCandidate(
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
            provider.id,
          );
        }
        if (scored && (!best || scored.confidence > best.confidence)) {
          best = scored;
        }
      }
      if (best) return { ...best, rateLimited: best.rateLimited || rateLimited };
    }

    // No source produced a trusted hit → report a miss (or the rate-limit flag).
    return { result: null, source: '', confidence: 0, rateLimited };
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
