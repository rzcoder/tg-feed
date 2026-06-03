// Paginated activity feed. Sub FK is ON DELETE SET NULL, so rows for deleted subs survive with null titles; the dest join hops through the sub's current destinationId, so re-pointing surfaces the new dest on old rows.
// Pagination is the limit+1 trick (one row past limit → nextOffset, else null), avoiding a COUNT(*). Sort desc(createdAt),desc(id) so albums sharing a createdAt ms paginate deterministically.
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  forwardLogQuerySchema,
  type ForwardLogEntryDto,
  type ForwardLogRawResponse,
  type ForwardLogResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { destinations, forwardLog, subscriptions } from '../../db/schema.js';

const rawParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export interface RegisterForwardLogDeps {
  db: Db;
}

export function registerForwardLogRoutes(app: FastifyInstance, deps: RegisterForwardLogDeps): void {
  const { db } = deps;

  app.get('/forward-log', async (request) => {
    const { limit, offset } = forwardLogQuerySchema.parse(request.query);

    const rows = db
      .select({
        id: forwardLog.id,
        subscriptionId: forwardLog.subscriptionId,
        subscriptionTitle: subscriptions.sourceTitle,
        sourceHandle: subscriptions.handle,
        destinationName: destinations.name,
        sourceMessageId: forwardLog.sourceMessageId,
        destMessageId: forwardLog.destMessageId,
        status: forwardLog.status,
        error: forwardLog.error,
        createdAt: forwardLog.createdAt,
        // Presence only (raw JSON is fetched via /:id/raw); SQLite returns 1/0.
        hasRawMessage: sql<number>`(${forwardLog.rawMessage} IS NOT NULL)`,
      })
      .from(forwardLog)
      .leftJoin(subscriptions, eq(forwardLog.subscriptionId, subscriptions.id))
      .leftJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .orderBy(desc(forwardLog.createdAt), desc(forwardLog.id))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const hasMore = rows.length > limit;
    const items: ForwardLogEntryDto[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      subscriptionId: row.subscriptionId,
      subscriptionTitle: row.subscriptionTitle,
      sourceHandle: row.sourceHandle,
      destinationName: row.destinationName,
      sourceMessageId: row.sourceMessageId,
      destMessageId: row.destMessageId,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      hasRawMessage: Boolean(row.hasRawMessage),
    }));
    const response: ForwardLogResponse = {
      items,
      nextOffset: hasMore ? offset + limit : null,
    };
    return response;
  });

  // Deferred raw-JSON fetch, off the list route so page loads don't drag tens of KB per row.
  app.get('/forward-log/:id/raw', async (request, reply) => {
    const { id } = rawParamsSchema.parse(request.params);
    const row = db
      .select({ rawMessage: forwardLog.rawMessage })
      .from(forwardLog)
      .where(eq(forwardLog.id, id))
      .get();
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const response: ForwardLogRawResponse = { rawMessage: row.rawMessage ?? null };
    return response;
  });
}
