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
});
