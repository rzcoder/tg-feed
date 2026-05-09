/**
 * Single Fastify error handler.
 *
 * All errors thrown from route handlers, pre-handlers, and Fastify itself
 * pass through here. The mapping:
 *
 *   - `ZodError` (route handler called `schema.parse(body)` and it threw)
 *     → 400 with `{ code: 'validation_error', issues }`
 *   - `AppError` subclasses (`UnauthorizedError`, `NotFoundError`, ...)
 *     → `err.statusCode` with `{ code, message, ...(issues if ValidationError) }`
 *   - anything else → 500 generic; original message NOT echoed (no leaking
 *     of internal details). Logged with `request.log.error({ err })` for
 *     diagnosability.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ErrorResponse } from '@tg-feed/shared';
import type { Logger } from '../lib/logger.js';
import { AppError, ValidationError } from '../lib/errors.js';

export type ApiErrorHandler = (
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) => void;

export function makeErrorHandler(logger: Logger): ApiErrorHandler {
  return function errorHandler(err, request, reply) {
    if (err instanceof ZodError) {
      const body: ErrorResponse = {
        error: { code: 'validation_error', message: 'invalid request', issues: err.issues },
      };
      reply.status(400).send(body);
      return;
    }

    if (err instanceof AppError) {
      const body: ErrorResponse = {
        error: {
          code: err.code,
          message: err.message,
          ...(err instanceof ValidationError && err.issues !== undefined
            ? { issues: Array.isArray(err.issues) ? err.issues : [err.issues] }
            : {}),
        },
      };
      reply.status(err.statusCode).send(body);
      return;
    }

    logger.error({ err, url: request.url }, 'unhandled error in API request');
    const body: ErrorResponse = {
      error: { code: 'internal', message: 'internal server error' },
    };
    reply.status(500).send(body);
  };
}
