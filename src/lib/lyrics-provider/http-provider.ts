/**
 * HTTP lyrics provider adapter (ISSUE #148, Phase 1 unified abstraction).
 *
 * Wraps the raw HTTP protocol client (`searchHttpProvider`) behind the shared
 * `LyricsProvider` contract so runtime plugins are scheduled by the same
 * orchestrator loop as the builtin sources. The caller's cancel signal and the
 * per-provider timeout are wired in via `ProviderContext`.
 */
import type { LyricsProvider, LyricsProviderQuery, ProviderContext, ProviderOutcome } from './types.ts';
import { searchHttpProvider } from './http-client.ts';
import type { ProviderConfigRow } from './config.ts';

/** Build a `LyricsProvider` adapter for one stored HTTP provider config. */
export function httpLyricsProvider(cfg: ProviderConfigRow, authSecret: string | null, timeoutMs: number): LyricsProvider {
  return {
    id: `plugin:${cfg.id}:${cfg.protocolVersion}`,
    displayName: cfg.name,
    kind: 'http',
    async search(query: LyricsProviderQuery, context: ProviderContext): Promise<ProviderOutcome> {
      context.onStage?.({
        id: `plugin:${cfg.id}:${cfg.protocolVersion}`,
        displayName: cfg.name,
        kind: 'http',
      });
      return searchHttpProvider(
        {
          baseUrl: cfg.baseUrl,
          authType: cfg.authType,
          authSecret,
          timeoutMs,
        },
        query,
        timeoutMs,
        crypto.randomUUID(),
        context.signal,
      );
    },
  };
}


