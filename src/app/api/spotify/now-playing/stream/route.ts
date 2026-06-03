import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { subscribe } from '@/lib/spotify-poller';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let unsub: (() => void) | null = null;
      let alive = true;

      const send = (data: unknown) => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

      // Detect client disconnect
      request.signal.addEventListener('abort', cleanup);

      // Send initial heartbeat immediately
      send({ _heartbeat: true });

      // Subscribe to shared poller
      unsub = subscribe(user.email, send);

      // Heartbeat every 30s to keep connection alive and detect zombies
      const heartbeat = setInterval(() => {
        if (!alive) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 30_000);

      // Cleanup on stream cancel
      const origCancel = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(heartbeat);
        cleanup();
        try { origCancel(); } catch { /* */ }
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
