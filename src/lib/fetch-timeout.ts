/**
 * Shared request budget for every Spotify upstream call (issue #370).
 *
 * The rest of the codebase already bounds its network calls (lyrics chain,
 * linkcore, translation, yt-sidecar). The Spotify paths were the one exception:
 * bare `fetch` with no `AbortController`, so an upstream that accepted the
 * connection and then never answered (queued request, network black hole,
 * corporate proxy) left the promise pending forever.
 *
 * A pending promise is worse than a failure: it reaches neither the `catch`
 * branch (which is what reschedules a poll / degrades the UI) nor the success
 * branch, so sync froze silently with no way back short of a process restart.
 *
 * Kept free of Node-only imports: the client poller uses it too.
 */

/** Budget for a single Spotify API request (token refresh, track, search, poll). */
export const SPOTIFY_REQUEST_TIMEOUT_MS = 6_000;

/**
 * Budget for the browser's own `GET /api/spotify/now-playing` poll.
 *
 * Larger than ONE server-side Spotify call, so the common stall (the upstream
 * GET hanging) surfaces as the server's structured `error: 504` instead of a
 * bare aborted fetch. A server path that hangs on both legs (token refresh +
 * GET) can still outlast this; the client then times out on its own and reaches
 * the same degraded state — either way the loop keeps a next round scheduled.
 */
export const SPOTIFY_CLIENT_POLL_TIMEOUT_MS = 8_000;

/** True when `error` is the rejection of a fetch aborted by its signal. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { name?: string }).name === 'AbortError';
}

/**
 * Raised when OUR deadline (not the caller) ended a request. Distinguished from
 * a caller cancel so callers can map it to a retryable "upstream timeout" code
 * instead of reporting a user cancel or a genuine disconnect.
 */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`fetch timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isFetchTimeoutError(error: unknown): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}

export interface TimeoutBudget {
  signal: AbortSignal;
  /** Rejects as soon as the deadline fires — settled work is not required to observe the signal. */
  deadline: Promise<never>;
  /** True once the deadline (not the caller) aborted the signal. */
  timedOut: () => boolean;
  /** Always call in a `finally` — the timer must not outlive the request. */
  dispose: () => void;
}

/**
 * Compose the caller's cancel signal with a hard deadline.
 *
 * `AbortSignal.any` is used when available (Node 20+/Workers/browsers);
 * otherwise composition degrades to event listeners so the deadline still
 * bounds the request on older runtimes.
 *
 * The returned `deadline` promise rejects on its own, so the budget is enforced
 * even when the underlying call ignores its signal — relying on abort alone
 * makes the guarantee depend on every future fetch implementation.
 */
export function createTimeoutBudget(timeoutMs: number, external?: AbortSignal): TimeoutBudget {
  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: (error: unknown) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  // The deadline may never be raced (a caller can dispose the budget first);
  // an unobserved rejection would otherwise surface as an unhandled error.
  deadline.catch(() => {});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline(new FetchTimeoutError(timeoutMs));
  }, timeoutMs);
  let signal: AbortSignal;
  if (typeof AbortSignal.any === 'function') {
    signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
  } else {
    if (external?.aborted) controller.abort();
    else external?.addEventListener('abort', () => controller.abort(), { once: true });
    signal = controller.signal;
  }
  return {
    signal,
    deadline,
    timedOut: () => timedOut,
    dispose: () => clearTimeout(timer),
  };
}

/**
 * Run one request under a hard deadline, keeping the deadline armed while
 * `consume` runs — a stalled body read is the same failure as a stalled
 * response, and it is just as invisible to the caller.
 *
 * Rejects with {@link FetchTimeoutError} when OUR deadline fired; a caller
 * cancel keeps its original `AbortError` so it is never mistaken for a
 * retryable upstream timeout. `fetchImpl` is a parameter so the budget itself is
 * testable with a hanging fake.
 */
export async function withFetchDeadline<T>(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const budget = createTimeoutBudget(timeoutMs, init.signal ?? undefined);
  try {
    const work = (async () => consume(await fetchImpl(input, { ...init, signal: budget.signal })))();
    return await Promise.race([work, budget.deadline]);
  } catch (error) {
    if (budget.timedOut()) throw new FetchTimeoutError(timeoutMs);
    throw error;
  } finally {
    budget.dispose();
  }
}

/** `fetch` bounded by `timeoutMs`. Resolves exactly like `fetch`. */
export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = SPOTIFY_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return withFetchDeadline(fetchImpl, input, init, timeoutMs, async (response) => response);
}

/** `fetch` + `response.json()`, both inside the same deadline. */
export function fetchJsonWithTimeout<T = unknown>(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = SPOTIFY_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; data: T }> {
  return withFetchDeadline(fetchImpl, input, init, timeoutMs, async (response) => ({
    response,
    data: (await response.json()) as T,
  }));
}
