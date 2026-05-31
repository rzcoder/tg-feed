import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  pretty?: boolean;
  silent?: boolean;
}

/**
 * Belt-and-suspenders redaction list. Existing call sites are audited not to
 * log these, but this guards against future code paths accidentally bundling
 * them into a log object — pino redacts BEFORE the transport sees the record,
 * so they never reach disk / stdout / log shipping.
 *
 * Paths use pino's path notation. `*` matches one level; multi-level wildcards
 * are not supported, so every common shape is enumerated. Cheap at runtime.
 */
const REDACT_PATHS = [
  // Request/response headers
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  // Web auth + cookies
  'password',
  '*.password',
  '*.*.password',
  'cookie',
  '*.cookie',
  'SESSION_SECRET',
  '*.SESSION_SECRET',
  // Telegram session material
  'sessionString',
  '*.sessionString',
  'TG_SESSION_STRING',
  '*.TG_SESSION_STRING',
  'encryptedSessionString',
  '*.encryptedSessionString',
  'TG_SESSION_ENCRYPTION_KEY',
  '*.TG_SESSION_ENCRYPTION_KEY',
  // Bot token + Mini App init payload (the latter carries a user-bound HMAC)
  'TG_BOT_TOKEN',
  '*.TG_BOT_TOKEN',
  'initData',
  '*.initData',
  // Login flow secrets / bearer tokens
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
