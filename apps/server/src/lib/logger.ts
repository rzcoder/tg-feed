import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

export type { Logger } from 'pino';

const BOT_TOKEN_PATTERN = /(\d{6,12}):[A-Za-z0-9_-]{30,}/g;

export function scrubSecrets(text: string): string {
  return text.replace(BOT_TOKEN_PATTERN, '$1:[REDACTED]');
}

function scrubErrorStrings(node: unknown, depth: number): void {
  if (depth > 5 || node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record.message === 'string') record.message = scrubSecrets(record.message);
  if (typeof record.stack === 'string') record.stack = scrubSecrets(record.stack);
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') scrubErrorStrings(value, depth + 1);
  }
}

// pino runs `formatters.log` before serializers, so the scrub has to hook the
// serializer output — that is the point where messages and stacks exist as
// plain strings.
function scrubbedErrSerializer(err: unknown): unknown {
  const serialized = pino.stdSerializers.err(err as Error);
  scrubErrorStrings(serialized, 0);
  return serialized;
}

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  pretty?: boolean;
  silent?: boolean;
  /** Sink override; the default writes to stdout. Lets tests read back what was emitted. */
  destination?: pino.DestinationStream;
}

// pino's `*` matches a single level only, so every nesting depth is enumerated by hand.
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'password',
  '*.password',
  '*.*.password',
  'cookie',
  '*.cookie',
  'SESSION_SECRET',
  '*.SESSION_SECRET',
  'sessionString',
  '*.sessionString',
  'TG_SESSION_STRING',
  '*.TG_SESSION_STRING',
  'encryptedSessionString',
  '*.encryptedSessionString',
  'TG_SESSION_ENCRYPTION_KEY',
  '*.TG_SESSION_ENCRYPTION_KEY',
  'TG_BOT_TOKEN',
  '*.TG_BOT_TOKEN',
  'initData',
  '*.initData',
  'phoneCode',
  '*.phoneCode',
  'phoneCodeHash',
  '*.phoneCodeHash',
  'code',
  '*.code',
  'inviteHash',
  '*.inviteHash',
];

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.silent ? 'silent' : (opts.level ?? config.LOG_LEVEL);
  const pretty = opts.pretty ?? config.NODE_ENV === 'development';

  const options: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]', remove: false },
    serializers: { err: scrubbedErrSerializer, error: scrubbedErrSerializer },
  };
  if (pretty && !opts.silent) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

export const logger: Logger = createLogger();
