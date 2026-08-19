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

/** Explicit, fail-closed bounds for every deployment budget value. */
export const BUDGET_BOUNDS = {
  max: { min: 5_000, max: 300_000, fallback: PROVIDER_MAX_TIMEOUT_MS },
  default: { min: 1_000, max: 300_000, fallback: PROVIDER_DEFAULT_TIMEOUT_MS },
  manifest: { min: 1_000, max: 300_000, fallback: PROVIDER_MANIFEST_TIMEOUT_MS },
  chain: { min: 5_000, max: 600_000, fallback: PROVIDER_CHAIN_TIMEOUT_MS },
} as const;

/**
 * Read + clamp an integer env var. Missing, non-numeric, out-of-range or
 * non-finite values fall back to the safe default (fail-closed) rather than
 * trusting an extreme deployment override.
 */
function readBoundedEnv(name: string, bounds: { min: number; max: number; fallback: number }): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') return bounds.fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return bounds.fallback;
  const floor = Math.floor(n);
  if (floor < bounds.min || floor > bounds.max) return bounds.fallback;
  return floor;
}

export interface BudgetConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  manifestTimeoutMs: number;
  chainTimeoutMs: number;
}

export function getBudgetConfig(): BudgetConfig {
  const maxTimeoutMs = readBoundedEnv('LYRICS_PROVIDER_MAX_TIMEOUT_MS', BUDGET_BOUNDS.max);
  // Per-request / manifest / chain budgets are additionally clamped to the max
  // ceiling so a provider timeout never exceeds the admin-configurable ceiling.
  const defaultTimeoutMs = Math.min(
    maxTimeoutMs,
    readBoundedEnv('LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS', BUDGET_BOUNDS.default),
  );
  const manifestTimeoutMs = Math.min(
    maxTimeoutMs,
    readBoundedEnv('LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS', BUDGET_BOUNDS.manifest),
  );
  const chainTimeoutMs = readBoundedEnv('LYRICS_PROVIDER_CHAIN_TIMEOUT_MS', BUDGET_BOUNDS.chain);
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
