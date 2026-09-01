import type { SyncStage } from '@/lib/lyrics-fetcher';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { readSseFrames } from '@/lib/sse-reader';

// The sync response is an untyped union of outcomes (not-found, plain-hit
// preview, low-confidence preview, direct write, rate-limit…). Its shape is
// intentionally loose (mirrors the previous `res.json()` behaviour), so the
// result body is typed `any`; the exact fields are read in flag-checked
// branches in `runSync`.
/* eslint-disable @typescript-eslint/no-explicit-any -- SSE payload is intentionally untyped. */
/**
 * Read the Server-Sent Events response produced by the sync route. Emits each
 * `stage` event to `onStage` (so the UI can show "正在查询 LRCLIB…" live) and
 * resolves with the payload of the terminal `result` / `error` event — the same
 * object the previous plain-JSON response carried, plus its HTTP status.
 */
export async function readSyncEventStream(
  res: Response,
  onStage: (stage: SyncStage | ProviderStage) => void,
): Promise<{ status: number; body: any }> {
  const body = res.body;
  if (!body) {
    // Not a stream (e.g. an early JSON error before streaming began) — read as JSON.
    const jsonBody = await res.json();
    return { status: res.status, body: jsonBody };
  }
  let terminal: { status: number; body: any } | null = null;
  for await (const { event, data: dataStr } of readSseFrames(body)) {
    let payload: { status?: number; stage?: SyncStage | ProviderStage; body?: any };
    try {
      payload = JSON.parse(dataStr);
    } catch {
      continue;
    }
    if (event === 'stage' && payload.stage) {
      onStage(payload.stage);
    } else if (event === 'result' || event === 'error') {
      terminal = { status: payload.status ?? res.status, body: payload.body ?? payload };
      break;
    }
  }
  // Defensive: if the stream ended without a terminal event, surface a generic error.
  if (!terminal) {
    return { status: res.status || 500, body: { synced: false, error: 'network_error' } };
  }
  return terminal;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
