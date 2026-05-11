import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createHealthMonitor, type HealthProbeClient } from './healthMonitor.js';

const logger = createLogger({ silent: true });

function makeClient(behaviour: () => Promise<unknown>): HealthProbeClient {
  return { invoke: vi.fn(behaviour) };
}

describe('createHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes connected=true on a successful probe', async () => {
    const client = makeClient(() => Promise.resolve({}));
    const onStatusChange = vi.fn();
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange,
      intervalMs: 100,
    });

    await monitor.probe();
    expect(onStatusChange).toHaveBeenCalledWith({ state: 'connected', connected: true });
    monitor.stop();
  });

  it('publishes connected=false with reason when invoke throws', async () => {
    const client = makeClient(() => Promise.reject(new Error('AUTH_KEY_UNREGISTERED')));
    const onStatusChange = vi.fn();
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange,
      intervalMs: 100,
    });

    await monitor.probe();
    expect(onStatusChange).toHaveBeenCalledWith({
      state: 'disconnected',
      connected: false,
      reason: 'AUTH_KEY_UNREGISTERED',
    });
    monitor.stop();
  });

  it('runs an immediate probe on start, then polls on the configured interval', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      return Promise.resolve({});
    });
    const onStatusChange = vi.fn();
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange,
      intervalMs: 1000,
    });

    monitor.start();
    // Immediate probe is async — flush microtasks.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(4);

    monitor.stop();
  });

  it('stop prevents further probes', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      return Promise.resolve({});
    });
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: () => {},
      intervalMs: 500,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);
  });

  it('reports recovery: failure then success transitions back to connected', async () => {
    let shouldFail = true;
    const client = makeClient(() => {
      return shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve({});
    });
    const onStatusChange = vi.fn();
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange,
      intervalMs: 100,
    });

    await monitor.probe();
    expect(onStatusChange).toHaveBeenLastCalledWith({
      state: 'disconnected',
      connected: false,
      reason: 'boom',
    });

    shouldFail = false;
    await monitor.probe();
    expect(onStatusChange).toHaveBeenLastCalledWith({ state: 'connected', connected: true });
    monitor.stop();
  });

  it('times out a stuck invoke and reports disconnected', async () => {
    // Never-resolving invoke — simulates a sender stuck mid-reconnect where
    // `client.invoke()` would otherwise block forever.
    const client = makeClient(() => new Promise<unknown>(() => {}));
    const onStatusChange = vi.fn();
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange,
      intervalMs: 100,
      probeTimeoutMs: 500,
    });

    const probePromise = monitor.probe();
    await vi.advanceTimersByTimeAsync(500);
    await probePromise;

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disconnected', connected: false }),
    );
    const lastCall = onStatusChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.reason).toMatch(/timed out/);
    monitor.stop();
  });

  it('triggers requestReload after threshold consecutive failures', async () => {
    const client = makeClient(() => Promise.reject(new Error('stuck')));
    const requestReload = vi.fn().mockResolvedValue(undefined);
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: () => {},
      requestReload,
      intervalMs: 100,
      reloadThreshold: 3,
    });

    await monitor.probe();
    expect(requestReload).not.toHaveBeenCalled();
    await monitor.probe();
    expect(requestReload).not.toHaveBeenCalled();
    await monitor.probe();
    expect(requestReload).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('resets failure counter on a successful probe', async () => {
    let shouldFail = true;
    const client = makeClient(() => {
      return shouldFail ? Promise.reject(new Error('flaky')) : Promise.resolve({});
    });
    const requestReload = vi.fn().mockResolvedValue(undefined);
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: () => {},
      requestReload,
      intervalMs: 100,
      reloadThreshold: 3,
    });

    await monitor.probe();
    await monitor.probe();
    // One success: counter resets, so the next two failures alone shouldn't
    // breach the threshold.
    shouldFail = false;
    await monitor.probe();
    shouldFail = true;
    await monitor.probe();
    await monitor.probe();
    expect(requestReload).not.toHaveBeenCalled();
    monitor.stop();
  });

  it('does not stack reload requests while one is in flight', async () => {
    const client = makeClient(() => Promise.reject(new Error('stuck')));
    let resolveReload: () => void = () => {};
    const requestReload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        }),
    );
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: () => {},
      requestReload,
      intervalMs: 100,
      reloadThreshold: 2,
    });

    await monitor.probe();
    await monitor.probe();
    expect(requestReload).toHaveBeenCalledTimes(1);

    // Further probes while reload is mid-flight should be skipped entirely
    // (no invoke, no second reload).
    const invokeCallsBefore = (client.invoke as ReturnType<typeof vi.fn>).mock.calls.length;
    await monitor.probe();
    await monitor.probe();
    expect((client.invoke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(invokeCallsBefore);
    expect(requestReload).toHaveBeenCalledTimes(1);

    // After reload settles, probes resume and a fresh failure streak can
    // trigger a new reload.
    resolveReload();
    await vi.advanceTimersByTimeAsync(0);
    await monitor.probe();
    await monitor.probe();
    expect(requestReload).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('does not crash when requestReload is omitted', async () => {
    const client = makeClient(() => Promise.reject(new Error('stuck')));
    const monitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: () => {},
      intervalMs: 100,
      reloadThreshold: 2,
    });

    await monitor.probe();
    await monitor.probe();
    await monitor.probe();
    // Smoke test: monitor still runs; no requestReload to call.
    monitor.stop();
  });
});
