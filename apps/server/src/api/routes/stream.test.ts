/**
 * SSE stream route tests.
 *
 * Test mechanics, verified against `light-my-request@6.6.0`:
 *
 *   - `inject({ payloadAsStream: true })` resolves the promise at
 *     `reply.raw.writeHead(...)` time, BEFORE the response body has flushed.
 *     That's why the test reads `res.statusCode` / `res.headers` immediately
 *     and only then starts consuming chunks via `res.stream()`.
 *   - `res.stream()` returns a `Readable`. It does not auto-end — the SSE
 *     handler keeps the response open by design. The test must terminate
 *     the connection explicitly. We wrap the entire interaction in a
 *     `request.raw.destroy()`-style abort using an `AbortController` passed
 *     to `inject`. On abort the handler's `request.raw.once('close')`
 *     listener fires, the bus listener unsubscribes, and the heartbeat
 *     interval is cleared.
 *   - Real timers (`vi.useRealTimers()` is the default) — fake timers race
 *     with `light-my-request`'s nextTick-driven chunk delivery and produce
 *     flaky heartbeat tests. The `heartbeatMs` deps override lets the test
 *     pin a 50 ms interval and assert within ~150 ms.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../testing.js';

interface SseEvent {
  type?: string;
  data?: string;
  comment?: string;
}

/** Parse SSE frames out of an accumulating buffer. Each frame ends with `\n\n`. */
function parseSseFrames(buf: string): SseEvent[] {
  const frames: SseEvent[] = [];
  for (const raw of buf.split('\n\n')) {
    if (raw === '') continue;
    const lines = raw.split('\n');
    const event: SseEvent = {};
    for (const line of lines) {
      if (line.startsWith(': ')) {
        event.comment = line.slice(2);
      } else if (line.startsWith('event: ')) {
        event.type = line.slice(7);
      } else if (line.startsWith('data: ')) {
        event.data = line.slice(6);
      }
    }
    frames.push(event);
  }
  return frames;
}

/**
 * Read chunks until `predicate` returns true, then return the accumulated
 * buffer. `timeoutMs` guards against a hang if the predicate never fires.
 * The reader keeps draining quietly after the predicate fires so we can
 * abort the upstream and let the stream end cleanly.
 */
async function readUntil(
  stream: NodeJS.ReadableStream,
  predicate: (buf: string) => boolean,
  timeoutMs = 1500,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(
          new Error(`SSE readUntil timed out after ${timeoutMs}ms; got: ${JSON.stringify(buf)}`),
        );
      }
    }, timeoutMs);
    stream.on('data', (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!resolved && predicate(buf)) {
        resolved = true;
        clearTimeout(timer);
        resolve(buf);
      }
    });
    stream.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(buf);
      }
    });
    stream.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

describe('GET /api/stream', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp({ heartbeatMs: 50 });
    cookie = await testApp.loginAndGetCookie();
  });

  afterEach(async () => {
    await testApp.close();
  });

  it('returns 401 without cookie (auth scope coverage)', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/stream' });
    expect(res.statusCode).toBe(401);
  });

  it('opens with 200, text/event-stream, and an initial `: open` comment frame', async () => {
    const controller = new AbortController();
    const resPromise = testApp.app.inject({
      method: 'GET',
      url: '/api/stream',
      headers: { cookie },
      payloadAsStream: true,
      signal: controller.signal,
    });
    const res = await resPromise;

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);

    const buf = await readUntil(res.stream(), (b) => b.includes(': open\n\n'));
    expect(buf).toContain(': open\n\n');

    controller.abort();
  });

  it('delivers a bus event as an SSE frame with type and JSON data', async () => {
    const controller = new AbortController();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/stream',
      headers: { cookie },
      payloadAsStream: true,
      signal: controller.signal,
    });
    expect(res.statusCode).toBe(200);

    // Wait for the bus listener to be wired (handler resolves shortly after writeHead).
    await new Promise((r) => setImmediate(r));
    expect(testApp.bus.listenerCount()).toBe(1);

    testApp.bus.emit({
      type: 'forward.completed',
      subscriptionId: 42,
      sourceChatId: '-100SRC',
      destinationChatId: '-100DEST',
      sourceMessageIds: ['10'],
      destMessageIds: ['999'],
      forwardLogIds: [1],
    });

    // Wait for the full frame: event line + data line + terminator. Two
    // separate `socket.write` calls may arrive as separate chunks, so a
    // predicate that matches just the event line risks parsing mid-frame.
    const buf = await readUntil(res.stream(), (b) => {
      const idx = b.indexOf('event: forward.completed\n');
      return idx > -1 && b.indexOf('\n\n', idx) > -1;
    });
    const frames = parseSseFrames(buf);
    const completed = frames.find((f) => f.type === 'forward.completed');
    const payload = JSON.parse(completed!.data!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'forward.completed',
      subscriptionId: 42,
      sourceMessageIds: ['10'],
      destMessageIds: ['999'],
    });
    expect(typeof payload.occurredAt).toBe('string');

    controller.abort();
  });

  it('emits heartbeat comment frames at the configured interval', async () => {
    const controller = new AbortController();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/stream',
      headers: { cookie },
      payloadAsStream: true,
      signal: controller.signal,
    });
    expect(res.statusCode).toBe(200);

    const buf = await readUntil(res.stream(), (b) => b.includes(': heartbeat\n\n'), 1500);
    expect(buf).toContain(': heartbeat\n\n');

    controller.abort();
  });

  it('unsubscribes from the bus and clears the heartbeat when the client disconnects', async () => {
    const controller = new AbortController();
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/stream',
      headers: { cookie },
      payloadAsStream: true,
      signal: controller.signal,
    });
    expect(res.statusCode).toBe(200);

    // Drain `: open` so the connection is fully established before we tear down.
    await readUntil(res.stream(), (b) => b.includes(': open\n\n'));
    expect(testApp.bus.listenerCount()).toBe(1);

    controller.abort();
    // Give the close handler a tick to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(testApp.bus.listenerCount()).toBe(0);
  });
});
