import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  pretty?: boolean;
  silent?: boolean;
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
  };
  if (pretty && !opts.silent) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return pino(options);
}

export const logger: Logger = createLogger();
