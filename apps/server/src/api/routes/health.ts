// Unauthenticated on purpose (container/proxy probe, not the web client); `select 1` gives a real 503 not-ready signal.
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';

export interface RegisterHealthDeps {
  db: Db;
  logger: Logger;
}

export function registerHealthRoute(app: FastifyInstance, deps: RegisterHealthDeps): void {
  app.get('/health', async (_request, reply) => {
    try {
      deps.db.get(sql`select 1`);
    } catch (err) {
      deps.logger.error({ err }, 'health: database ping failed');
      return reply.status(503).send({ status: 'error' });
    }
    return { status: 'ok' };
  });
}
