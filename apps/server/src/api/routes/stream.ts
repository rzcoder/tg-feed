/**
 * SSE stream — `GET /api/stream`.
 *
 * One persistent text/event-stream per authenticated client. The route
 * subscribes to the in-process `EventBus` and pipes every emitted event to
 * the socket as a single SSE frame; a `: heartbeat` comment frame goes out
 * every 25 s so reverse proxies and Telegram-paranoid networks don't decide
 * the idle connection is dead.
 *
 * Hardening (added during the security pass):
 *   - **Per-session connection cap.** A single authed cookie can hold at
 *     most `MAX_CONNECTIONS_PER_TOKEN` streams open at once; further
 *     attempts get a clean 429. Without the cap a stolen cookie or a
 *     misbehaving extension could open thousands of streams and pin event-
 *     loop time on every bus emit (the bus walks every listener O(N)).
 *   - **Backpressure-aware writes.** `socket.write` returns false when the
 *     OS send buffer fills; if we ignore that, a slow consumer accumulates
 *     unbounded data in node's internal write buffer. We drop events while
 *     backpressured and resume on the next `'drain'`. This loses fidelity
 *     for very slow clients (intentional) but never OOMs the process.
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
import { readSessionToken } from '../auth.js';

export const SSE_HEARTBEAT_MS = 25_000;
const MAX_CONNECTIONS_PER_TOKEN = 4;

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
  // Per-token open-connection counter. Lives in module scope so each Fastify
  // factory instance gets its own map (tests build fresh instances per
  // `beforeEach`, so no cross-test bleed).
  const openByToken = new Map<string, number>();

  app.get('/stream', (request, reply) => {
    const token = readSessionToken(request) ?? '';
    const open = openByToken.get(token) ?? 0;
    if (open >= MAX_CONNECTIONS_PER_TOKEN) {
      reply.code(429).send({
        error: {
          code: 'too_many_streams',
          message: `at most ${MAX_CONNECTIONS_PER_TOKEN} concurrent streams per session`,
        },
      });
      return;
    }
    openByToken.set(token, open + 1);

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

    // Backpressure: when `socket.write` returns false, the kernel send
    // buffer is full and node's internal `writable` buffer would start
    // growing without bound. Drop events until the socket emits `'drain'`.
    let backpressured = false;
    socket.on('drain', () => {
      backpressured = false;
    });

    const unsubscribe = bus.on((event) => {
      if (socket.writableEnded) return;
      if (backpressured) return;
      const ok =
        socket.write(`event: ${event.type}\n`) &&
        socket.write(`data: ${JSON.stringify(event)}\n\n`);
      if (!ok) backpressured = true;
    });
    const heartbeat = setInterval(() => {
      if (socket.writableEnded) return;
      if (backpressured) return;
      const ok = socket.write(': heartbeat\n\n');
      if (!ok) backpressured = true;
    }, heartbeatMs);

    request.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      const next = (openByToken.get(token) ?? 1) - 1;
      if (next <= 0) openByToken.delete(token);
      else openByToken.set(token, next);
    });
  });
}
