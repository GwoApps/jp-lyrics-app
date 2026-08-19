/**
 * Public API for the lyrics provider layer (ISSUE #148).
 *
 * Consumers (sync / import / import-playlist) call `fetchLyricsWithChain` —
 * the builtin chain + admin HTTP providers in one effective chain. The rest of
 * the exports are used by the admin API/UI and tests.
 */
export { fetchLyricsWithChain, type ProviderChainOptions } from './orchestrator.ts';
export type {
  LyricsProvider,
  LyricsProviderQuery,
  ProviderCandidate,
  ProviderContext,
  ProviderOutcome,
  ProviderStage,
  ProviderStatus,
} from './types.ts';
export {
  normalizeProviderBaseUrl,
  deriveEndpoints,
  getNetworkPolicy,
  isInsecureTransport,
  isPrivateIpv4,
  isPrivateIpv6,
  type NetworkPolicy,
  type PolicyError,
} from './policy.ts';
export {
  getBudgetConfig,
  clampConfiguredTimeoutMs,
  resolveProviderTimeoutMs,
  PROVIDER_DEFAULT_TIMEOUT_MS,
  PROVIDER_MAX_TIMEOUT_MS,
  PROVIDER_MANIFEST_TIMEOUT_MS,
  PROVIDER_CHAIN_TIMEOUT_MS,
} from './budget.ts';
export { encryptProviderSecret, decryptProviderSecret, hasProviderSecretKey, maskSecret } from './secret.ts';
export { fetchManifest, searchHttpProvider, parseManifest, PROTOCOL_NAME, PROTOCOL_VERSION, type ProviderManifest } from './http-client.ts';
export {
  getProviderConfig,
  listProviderConfigs,
  listEffectiveProviders,
  insertProviderConfig,
  updateProviderConfig,
  deleteProviderConfig,
  reorderProviders,
  providerHealthSnapshot,
  type ProviderConfigRow,
} from './config.ts';
