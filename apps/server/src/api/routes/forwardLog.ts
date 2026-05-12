/**
 * Forward log route — paginated activity feed source.
 *
 * Two LEFT JOINs: `forward_log → subscriptions → destinations`. The
 * subscription FK is `ON DELETE SET NULL`, so historic rows for deleted
 * subscriptions survive with `subscriptionId`/`subscriptionTitle`/
 * `sourceHandle`/`destinationName` all `null`. The destination join hops
 * through the subscription's current `destinationId` — `forward_log`
 * doesn't store the destination, so a re-pointed subscription will surface
 * its current destination on historical rows (matches the prior
 * client-side enrichment behavior).
 *
 * Pagination uses the `limit + 1` trick: fetch one row past the asked
 * `limit`, then if the extra row is present `nextOffset = offset + limit`,
 * else `nextOffset = null`. Avoids a separate `COUNT(*)` query while still
 * answering "is there more?".
 *
 * Sort is `desc(createdAt), desc(id)` — albums write N rows in one
 * transaction sharing a `createdAt` ms; sorting by `id` as a tiebreaker
 * makes pagination deterministic across calls.
 */
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
        // Surface presence-only here; the raw JSON itself is fetched on
        // demand via the dedicated /:id/raw route so list responses stay
        // small. SQLite renders the boolean as `1`/`0` which the cast
        // below normalises for the wire format.
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

  // Deferred-fetch endpoint for the raw JSON snapshot. Kept off the list
  // route so a page load doesn't drag tens of KB per row over the wire —
  // the JSON is only useful when the user clicks "View raw" on a specific
  // entry, and an album's array is identical across its N rows anyway.
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
