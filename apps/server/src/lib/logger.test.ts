import { describe, it, expect } from 'vitest';
import { createLogger, scrubSecrets } from './logger.js';

// Shape of a real leak: grammy wraps the fetch failure, and both layers quote
// the request URL — token and all.
const TOKEN = '8722986738:AA123456789012345-123456712_CfsI8';
const SECRET = TOKEN.split(':')[1];

function captureLine(emit: (log: ReturnType<typeof createLogger>) => void): string {
  let line = '';
  const log = createLogger({
    pretty: false,
    destination: {
      write(chunk: string) {
        line += chunk;
      },
    },
  });
  emit(log);
  return line;
}

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

  it('strips a bot token from a nested error message and stack', () => {
    const inner = new Error(
      `request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, reason: `,
    );
    const outer: Error & { error?: Error } = new Error("Network request for 'sendMessage' failed!");
    outer.error = inner;

    const line = captureLine((log) => log.warn({ err: outer, adminId: '156686514' }, 'boom'));

    expect(line).not.toContain(SECRET);
    expect(line).toContain('8722986738:[REDACTED]');
    // The surrounding diagnostics have to survive, or the log stops being useful.
    expect(line).toContain('api.telegram.org');
    expect(line).toContain('156686514');
  });

  it('strips a bot token logged under the `error` key', () => {
    const line = captureLine((log) =>
      log.error({ error: new Error(`token ${TOKEN} rejected`) }, 'boom'),
    );
    expect(line).not.toContain(SECRET);
  });
});

describe('scrubSecrets', () => {
  it('keeps the public bot id and drops the secret half', () => {
    expect(scrubSecrets(`bot${TOKEN}/sendMessage`)).toBe('bot8722986738:[REDACTED]/sendMessage');
  });

  it('strips every occurrence in a multi-line stack', () => {
    const stack = `FetchError: request to https://api.telegram.org/bot${TOKEN}/sendMessage failed\n    at https://api.telegram.org/bot${TOKEN}/getMe`;
    expect(scrubSecrets(stack)).not.toContain(SECRET);
  });

  it('leaves ordinary colon-separated values alone', () => {
    expect(scrubSecrets('sourceChatId: -1001454624971, took 1308ms')).toBe(
      'sourceChatId: -1001454624971, took 1308ms',
    );
    expect(scrubSecrets('12:30:45')).toBe('12:30:45');
  });
});
