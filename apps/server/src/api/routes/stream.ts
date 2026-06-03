// GET /api/stream: one text/event-stream per client piping every EventBus event; `: heartbeat` every 25s so proxies don't reap idle connections.
// Connection cap (429 past MAX_CONNECTIONS_PER_TOKEN): a stolen cookie could otherwise open thousands of streams and pin the O(N) bus walk.
// Backpressure: drop events while socket.write is false, resume on 'drain' — loses fidelity for slow clients but never OOMs.
// reply.hijack() stops Fastify calling .end() on return so the connection stays open until close.
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../events/bus.js';
import { readSessionToken } from '../auth.js';

export const SSE_HEARTBEAT_MS = 25_000;
const MAX_CONNECTIONS_PER_TOKEN = 4;

export interface RegisterStreamDeps {
  bus: EventBus;
  heartbeatMs?: number;
}

export function registerStreamRoutes(app: FastifyInstance, deps: RegisterStreamDeps): void {
  const { bus } = deps;
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;
  // Scoped per factory instance so fresh test instances don't bleed across each other.
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
    // Initial flush so the client sees the stream is live before the first real event.
    socket.write(': open\n\n');

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
