/**
 * Client-side reader for the translate endpoint's SSE stream.
 *
 * Consumes a text/event-stream response body and forwards `reasoning`
 * deltas live, then resolves with either the aligned `translations` array
 * (from the `done` event) or the error code (from the `error` event).
 * Works with fetch's ReadableStream — EventSource can't POST.
 */

export interface TranslationStreamResult {
  /** Aligned translation array, null when the stream ended with an error. */
  translations: string[] | null;
  /** Error code from the `error` event (e.g. ai_quota_exceeded). */
  error: string | null;
}

export async function readTranslationStream(
  body: ReadableStream<Uint8Array>,
  onReasoning: (delta: string) => void,
): Promise<TranslationStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let translations: string[] | null = null;
  let streamError: string | null = null;
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      let eventName = 'message';
      let dataStr = '';
      for (const line of evt.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!dataStr) continue;
      let payload: { text?: string; translations?: string[]; error?: string };
      try {
        payload = JSON.parse(dataStr);
      } catch {
        continue;
      }
      if (eventName === 'reasoning' && typeof payload.text === 'string') {
        onReasoning(payload.text);
      } else if (eventName === 'done' && Array.isArray(payload.translations)) {
        translations = payload.translations;
        finished = true;
      } else if (eventName === 'error' && payload.error) {
        streamError = payload.error;
        finished = true;
      }
    }
  }

  return { translations, error: streamError };
}
