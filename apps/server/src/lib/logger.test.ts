import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('returns a pino logger with info/warn/error/debug methods', () => {
    const log = createLogger({ silent: true });
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('honours the silent flag', () => {
    const log = createLogger({ silent: true });
    expect(log.level).toBe('silent');
  });

  it('honours an explicit level', () => {
    const log = createLogger({ level: 'warn', pretty: false });
    expect(log.level).toBe('warn');
  });
});
