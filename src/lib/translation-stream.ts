/**
 * Client-side reader for the translate endpoint's SSE stream.
 *
 * Consumes a text/event-stream response body and forwards `reasoning`
 * deltas live, then resolves with either the aligned `translations` array
 * (from the `done` event) or the error code (from the `error` event), plus the
 * terminology table the run used (`glossary` / `glossarySource`) so a draft-only
 * caller can hand it back on its next request (issue #405).
 * Works with fetch's ReadableStream — EventSource can't POST.
 */

import { readSseFrames } from '@/lib/sse-reader';
import type { GlossaryEntry, GlossarySource } from '@/lib/lyrics-glossary';

export interface TranslationProgress {
  /** Distinct lines the model has finished in THIS request. */
  requestDone: number;
  /** Distinct lines this request needs to process (repeated choruses deduped). */
  requestTotal: number;
  /** Full-song coverage: non-empty lyric lines that currently have a translation. */
  covered: number;
  /** Full-song coverage: non-empty lyric lines in the whole song (duplicates expanded). */
  coverable: number;
}

export interface TranslationStreamResult {
  /** Aligned translation array, null when the stream ended with an error. */
  translations: string[] | null;
  /**
   * The BCP-47 target language the returned translations were generated in
   * (from the server's `done` event). Null when unknown/not reported.
   */
  lang: string | null;
  /** Error code from the `error` event (e.g. ai_quota_exceeded). */
  error: string | null;
  /**
   * True when the server ran this translation WITHOUT a terminology
   * constraint because glossary extraction failed (issue #341). Distinct from
   * "the song has no terms", which is a normal result.
   */
  glossaryFailed: boolean;
  /**
   * The terminology table this run used (issue #405), or null when it ran
   * without one. The draft-only editor caches it and hands it back on the next
   * request so the same terms are reused instead of re-extracted per slice.
   */
  glossary: GlossaryEntry[] | null;
  /** Where `glossary` came from — 'stored' | 'extracted' | 'reused' | 'none'. */
  glossarySource: GlossarySource;
  /**
   * Progress snapshot reported alongside the error. The server persists the
   * complete lines that streamed in before the failure and reports how many
   * of the requested lines are now translated — the client can use it to
   * offer a "continue" button and show real numbers.
   */
  progress: TranslationProgress | null;
}

/**
 * Shape-check a `glossary` field without trusting it: the editor only ever
 * needs `{ original, translation }` pairs, and an older/newer server that sends
 * something else must not poison the cache it hands back. Anything malformed is
 * reported as "no table" — the next request then simply extracts again.
 */
function toGlossary(value: unknown): GlossaryEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries: GlossaryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { original, translation } = item as Partial<GlossaryEntry>;
    if (typeof original !== 'string' || typeof translation !== 'string') return null;
    entries.push({ original, translation });
  }
  return entries;
}

function toGlossarySource(value: unknown): GlossarySource {
  return value === 'stored' || value === 'extracted' || value === 'reused' || value === 'none'
    ? value
    : 'none';
}

export async function readTranslationStream(
  body: ReadableStream<Uint8Array>,
  onReasoning: (delta: string) => void,
  onProgress?: (progress: TranslationProgress) => void,
  onStage?: (stage: string) => void,
): Promise<TranslationStreamResult> {
  let translations: string[] | null = null;
  let streamLang: string | null = null;
  let streamError: string | null = null;
  let errorProgress: TranslationProgress | null = null;
  let glossaryFailed = false;
  let glossary: GlossaryEntry[] | null = null;
  let glossarySource: GlossarySource = 'none';
  let finished = false;

  for await (const { event: eventName, data: dataStr } of readSseFrames(body)) {
    let payload: {
      text?: string;
      translations?: string[];
      error?: string;
      lang?: string;
      stage?: string;
      glossary_failed?: boolean;
      glossary?: unknown;
      glossary_source?: string;
      requestDone?: number;
      requestTotal?: number;
      covered?: number;
      coverable?: number;
      // legacy fields from older server builds — kept for forward compatibility
      done?: number;
      total?: number;
    };
    try {
      payload = JSON.parse(dataStr);
    } catch {
      continue;
    }
    const toProgress = (p: typeof payload): TranslationProgress | null => {
      const hasNew = typeof p.requestDone === 'number' && typeof p.requestTotal === 'number'
        && typeof p.covered === 'number' && typeof p.coverable === 'number';
      if (hasNew) {
        return { requestDone: p.requestDone!, requestTotal: p.requestTotal!, covered: p.covered!, coverable: p.coverable! };
      }
      // Backward-compatible fallback for servers that only sent { done, total }.
      if (typeof p.done === 'number' && typeof p.total === 'number') {
        return { requestDone: p.done, requestTotal: p.total, covered: p.done, coverable: p.total };
      }
      return null;
    };
    if (eventName === 'reasoning' && typeof payload.text === 'string') {
      onReasoning(payload.text);
    } else if (eventName === 'stage' && typeof payload.stage === 'string') {
      onStage?.(payload.stage);
    } else if (eventName === 'progress') {
      const progress = toProgress(payload);
      if (progress) onProgress?.(progress);
    } else if (eventName === 'done' && Array.isArray(payload.translations)) {
      translations = payload.translations;
      if (typeof payload.lang === 'string') streamLang = payload.lang;
      glossaryFailed = payload.glossary_failed === true;
      glossary = toGlossary(payload.glossary);
      glossarySource = toGlossarySource(payload.glossary_source);
      finished = true;
    } else if (eventName === 'error' && payload.error) {
      streamError = payload.error;
      errorProgress = toProgress(payload);
      glossaryFailed = payload.glossary_failed === true;
      glossary = toGlossary(payload.glossary);
      glossarySource = toGlossarySource(payload.glossary_source);
      finished = true;
    }
    if (finished) break;
  }

  return {
    translations,
    lang: streamLang,
    error: streamError,
    progress: errorProgress,
    glossaryFailed,
    glossary,
    glossarySource,
  };
}
