/**
 * Client-side Server-Sent Events (SSE) frame reader.
 *
 * Consumes a `ReadableStream<Uint8Array>` (e.g. a fetch `res.body`) and
 * yields parsed frames one by one, splitting on the blank line (`\n\n`) that
 * separates SSE frames. Both the translation stream and the lyrics sync
 * stream share this parser — SSE protocol changes (multi-line `data:`,
 * `id:` fields, …) only need to be handled here.
 */

export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Generic async generator that yields parsed SSE frames from a ReadableStream.
 *
 * Frames are accumulated in a string buffer and split on `\n\n` (via
 * `indexOf` + `slice`, which avoids allocating a temporary array for the whole
 * buffer on every chunk). Each frame's `event:` and `data:` lines are
 * extracted; the default event name is `message`. Frames without any `data:`
 * line are skipped. Multi-line `data:` blocks are joined with `\n`.
 */
export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
        }
        if (data) yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
