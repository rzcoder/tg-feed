// Single Fastify error handler: ZodError → 400, AppError → its statusCode, anything else → generic 500 with the original message never echoed.
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

    // Fastify built-in 4xx (rate-limit, body too large, bad JSON) are client-safe; pass through. 5xx falls to the generic path.
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      const body: ErrorResponse = {
        error: { code: err.code ?? 'client_error', message: err.message },
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
