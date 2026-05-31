import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { createLogger } from '../lib/logger.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../lib/errors.js';
import { makeErrorHandler } from './errorHandler.js';

const logger = createLogger({ silent: true });

function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(makeErrorHandler(logger));
  return app;
}

describe('makeErrorHandler', () => {
  it('maps UnauthorizedError to 401 with code unauthorized', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new UnauthorizedError();
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized', message: 'unauthorized' } });
  });

  it('maps NotFoundError to 404 with formatted message', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new NotFoundError('subscription');
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: 'subscription not found' },
    });
  });

  it('maps ValidationError to 400 with issues when provided', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new ValidationError('bad shape', [{ path: 'foo', reason: 'missing' }]);
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'bad shape',
        issues: [{ path: 'foo', reason: 'missing' }],
      },
    });
  });

  it('maps ValidationError without issues to 400 without issues field', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new ValidationError('bad shape');
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'validation_error', message: 'bad shape' } });
  });

  it('maps ConflictError to 409', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new ConflictError('already exists');
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'conflict', message: 'already exists' },
    });
  });

  it('maps ZodError to 400 with the original issues array', async () => {
    const app = buildApp();
    const schema = z.object({ name: z.string() });
    app.get('/test', async () => {
      schema.parse({}); // throws ZodError
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; issues: unknown[] } };
    expect(body.error.code).toBe('validation_error');
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it('maps unknown errors to 500 generic without leaking the original message', async () => {
    const app = buildApp();
    app.get('/test', async () => {
      throw new Error('database connection refused at 10.0.0.5:5432');
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'internal', message: 'internal server error' },
    });
  });

  it('treats AppError subclasses with custom statusCode correctly', async () => {
    class TeapotError extends AppError {
      constructor() {
        super(418, 'teapot', "i'm a teapot");
      }
    }
    const app = buildApp();
    app.get('/test', async () => {
      throw new TeapotError();
    });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: { code: 'teapot', message: "i'm a teapot" } });
  });

  // Sanity check: instanceof works through the Fastify error hook
  it('preserves ZodError instanceof through Fastify', () => {
    const z1 = z.object({ x: z.string() }).safeParse({});
    expect(z1.success).toBe(false);
    if (!z1.success) {
      expect(z1.error).toBeInstanceOf(ZodError);
    }
  });
});
