import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  pretty?: boolean;
  silent?: boolean;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.silent ? 'silent' : (opts.level ?? config.LOG_LEVEL);
  const pretty = opts.pretty ?? config.NODE_ENV === 'development';

  const options: LoggerOptions = { level };
  if (pretty && !opts.silent) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return pino(options);
}

export const logger: Logger = createLogger();
