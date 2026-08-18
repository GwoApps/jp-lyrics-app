/**
 * Deployment-level request budget for HTTP lyrics providers (ISSUE #148).
 *
 * Defaults (also used as safe fallbacks when env vars are missing / invalid /
 * out of range):
 *   LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS = 20000   (single /v1/search budget)
 *   LYRICS_PROVIDER_MAX_TIMEOUT_MS      = 60000   (admin per-config override ceiling)
 *   LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS = 15000   (manifest / test-connection budget)
 *   LYRICS_PROVIDER_CHAIN_TIMEOUT_MS    = 180000  (whole effective chain budget)
 *
 * Builtin providers keep their original per-request timeouts (PetitLyrics 8s,
 * LRCLIB 15s, Uta-Net 15s, ytmusic 20s) — they are NOT squeezed to the plugin
 * default, avoiding a search-capability regression.
 */

export const PROVIDER_DEFAULT_TIMEOUT_MS = 20_000;
export const PROVIDER_MAX_TIMEOUT_MS = 60_000;
export const PROVIDER_MANIFEST_TIMEOUT_MS = 15_000;
export const PROVIDER_CHAIN_TIMEOUT_MS = 180_000;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export interface BudgetConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  manifestTimeoutMs: number;
  chainTimeoutMs: number;
}

export function getBudgetConfig(): BudgetConfig {
  const maxTimeoutMs = Math.max(
    PROVIDER_MAX_TIMEOUT_MS,
    Math.min(PROVIDER_MAX_TIMEOUT_MS, readIntEnv('LYRICS_PROVIDER_MAX_TIMEOUT_MS', PROVIDER_MAX_TIMEOUT_MS)),
  );
  const defaultTimeoutMs = Math.min(
    maxTimeoutMs,
    readIntEnv('LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS', PROVIDER_DEFAULT_TIMEOUT_MS),
  );
  const manifestTimeoutMs = Math.min(
    maxTimeoutMs,
    readIntEnv('LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS', PROVIDER_MANIFEST_TIMEOUT_MS),
  );
  const chainTimeoutMs = readIntEnv('LYRICS_PROVIDER_CHAIN_TIMEOUT_MS', PROVIDER_CHAIN_TIMEOUT_MS);
  return { defaultTimeoutMs, maxTimeoutMs, manifestTimeoutMs, chainTimeoutMs };
}

/**
 * Clamp an admin-supplied per-config timeout to the deployment ceiling.
 * `null` means "use the deployment default". Values are clamped to the
 * deployment max (admins cannot exceed env limits from DB/UI).
 */
export function resolveProviderTimeoutMs(
  configured: number | null | undefined,
  budget: BudgetConfig,
): number {
  if (!configured || configured <= 0) return budget.defaultTimeoutMs;
  return Math.min(budget.maxTimeoutMs, Math.max(5_000, configured));
}

/** Validate + clamp an admin-submitted timeout override (5–60s, clamped to max). */
export function clampConfiguredTimeoutMs(
  value: number | null | undefined,
  budget: BudgetConfig,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(budget.maxTimeoutMs, Math.max(5_000, Math.floor(value)));
}

/** Map an AbortError name for structured diagnostics. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
