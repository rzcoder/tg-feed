/**
 * SSE stream — `GET /api/stream`.
 *
 * One persistent text/event-stream per authenticated client. The route
 * subscribes to the in-process `EventBus` and pipes every emitted event to
 * the socket as a single SSE frame; a `: heartbeat` comment frame goes out
 * every 25 s so reverse proxies and Telegram-paranoid networks don't decide
 * the idle connection is dead.
 *
 * Implementation notes:
 *   - `reply.hijack()` tells Fastify "I'm taking over the response — don't
 *     try to call .send() or .end() yourself." After hijack the handler
 *     owns `reply.raw` (the underlying `http.ServerResponse`). We never
 *     return data via `reply.send`; everything goes via `socket.write`.
 *   - The handler resolves immediately after wiring listeners. Without
 *     `hijack` Fastify would call `.end()` on return; with it the
 *     connection stays open until the client disconnects.
 *   - `request.raw.once('close')` fires whether the client gracefully
 *     closes the EventSource, the network drops, or the test aborts via
 *     `AbortController`. That's where the heartbeat interval is cleared
 *     and the bus listener is unsubscribed — no per-client leak.
 *   - `socket.writableEnded` guards the listener and the heartbeat against
 *     a write-after-close race. The actual safety net is the per-listener
 *     try/catch inside the bus, which logs and swallows any thrown errors.
 *   - `X-Accel-Buffering: no` disables nginx response buffering for SSE
 *     (`Cache-Control: no-cache, no-transform` covers most other proxies).
 */
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../events/bus.js';

export const SSE_HEARTBEAT_MS = 25_000;

export interface RegisterStreamDeps {
  bus: EventBus;
  /**
   * Override the heartbeat interval for tests. Real timers + a small value
   * (e.g. 50 ms) is more reliable than fake-timer-driven heartbeat tests
   * because `light-my-request` chunk delivery is `process.nextTick`-driven,
   * which races with `vi.advanceTimersByTimeAsync`.
   */
  heartbeatMs?: number;
}

export function registerStreamRoutes(app: FastifyInstance, deps: RegisterStreamDeps): void {
  const { bus } = deps;
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;

  app.get('/stream', (request, reply) => {
    reply.hijack();
    const socket = reply.raw;
    socket.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Initial flush so the client sees the stream is live before the first
    // real event (which may be many seconds away).
    socket.write(': open\n\n');

    const unsubscribe = bus.on((event) => {
      if (socket.writableEnded) return;
      socket.write(`event: ${event.type}\n`);
      socket.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (socket.writableEnded) return;
      socket.write(': heartbeat\n\n');
    }, heartbeatMs);

    request.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
