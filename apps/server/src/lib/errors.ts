/**
 * Typed error hierarchy for HTTP route handlers.
 *
 * Throw these from inside route handlers; the Fastify error handler
 * (`api/errorHandler.ts`) reads `statusCode` + `code` and maps them to
 * the wire-format envelope `{ error: { code, message, issues? } }`.
 *
 * Anything not derived from `AppError` is treated as a 500 by the handler
 * with a generic `internal` message — so do not throw raw `Error` for
 * client-facing failure modes.
 */
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

/**
 * Thrown when an upstream service (Telegram via gramjs) is unreachable or
 * misbehaving. Maps to 503; the `code` is an explicit subtype the web UI
 * keys on for retry / fallback messaging.
 */
export class UpstreamError extends AppError {
  constructor(message: string, code = 'upstream_unavailable') {
    super(503, code, message);
  }
}

/**
 * Builds the right 503 for a Telegram dep that's currently undefined.
 * `telegram_initializing` (transient, retry) when the lifecycle phase is
 * still 'connecting'; `telegram_unavailable` (configure / re-login) for
 * the steady-state disconnected case. Both subscription and destination
 * routes use the same logic, so it lives here to keep the message and
 * code mapping consistent.
 */
export function telegramUnavailableError(status: { state: string }): UpstreamError {
  if (status.state === 'connecting') {
    return new UpstreamError('Telegram is starting up; retry in a moment', 'telegram_initializing');
  }
  return new UpstreamError('Telegram client not configured', 'telegram_unavailable');
}

/**
 * Thrown for "this shouldn't happen" cases — e.g. a row that exists at
 * INSERT-time disappearing before the immediate follow-up read. Maps to
 * 500; the message is logged but `errorHandler.ts` only echoes the
 * generic envelope, so internal context never leaks to the client.
 */
export class InternalError extends AppError {
  constructor(message: string) {
    super(500, 'internal', message);
  }
}
