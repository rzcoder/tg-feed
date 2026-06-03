// Throw these from route handlers; api/errorHandler.ts maps them to the wire envelope. A raw Error becomes a generic 500, so never throw one for client-facing failures.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'unauthorized') {
    super(401, 'unauthorized', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'not_found', `${resource} not found`);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(400, 'validation_error', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict') {
    super(409, code, message);
  }
}

// 503; `code` is a subtype the web UI keys on for retry/fallback messaging.
export class UpstreamError extends AppError {
  constructor(message: string, code = 'upstream_unavailable') {
    super(503, code, message);
  }
}

// telegram_initializing (retry) while 'connecting', else telegram_unavailable (configure/re-login).
export function telegramUnavailableError(status: { state: string }): UpstreamError {
  if (status.state === 'connecting') {
    return new UpstreamError('Telegram is starting up; retry in a moment', 'telegram_initializing');
  }
  return new UpstreamError('Telegram client not configured', 'telegram_unavailable');
}

// 500 for "shouldn't happen" cases; message is logged but never echoed to the client.
export class InternalError extends AppError {
  constructor(message: string) {
    super(500, 'internal', message);
  }
}
