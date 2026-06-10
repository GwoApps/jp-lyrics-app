import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_MODE = process.env.SPOTIFY_POLL_MODE || 'client';

export async function GET(request: NextRequest) {
  // In client mode, SSE stream is disabled — browser polls directly.
  // Guard BEFORE importing poller so bundlers can tree-shake it.
  if (POLL_MODE === 'client') {
    return new Response('SSE disabled — client polls directly', { status: 501 });
  }

  // Server mode: dynamic import keeps poller out of client-mode bundles
  const { subscribe } = await import('@/lib/spotify-poller');

  const user = await getAuthUser(request);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const wantFull = request.nextUrl.searchParams.get('full') === 'true';

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let unsub: (() => void) | null = null;
      let alive = true;

      const send = (msg: Record<string, unknown>) => {
        if (!alive) return;
        try {
          // Always send full data on first message or when ?full=true requested
          const payload = wantFull ? { ...msg, d: undefined, _full: true } : msg;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (!alive) return;
        alive = false;
        unsub?.();
        try { controller.close(); } catch { /* already closed */ }
      };

      request.signal.addEventListener('abort', cleanup);

      // Subscribe to shared poller (first message is always full data)
      unsub = subscribe(user.email, (_fullData, diffMsg) => {
        send(diffMsg as unknown as Record<string, unknown>);
      });

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        if (!alive) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 30_000);

      const origClose = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(heartbeat);
        cleanup();
        try { origClose(); } catch { /* */ }
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
