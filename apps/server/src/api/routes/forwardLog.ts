/**
 * Forward log route — paginated activity feed source.
 *
 * `LEFT JOIN subscriptions` — the FK is `ON DELETE SET NULL`, so historic
 * rows for deleted subscriptions need to survive with both `subscriptionId`
 * and `subscriptionTitle` as `null` rather than silently disappearing.
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
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  forwardLogQuerySchema,
  type ForwardLogEntryDto,
  type ForwardLogResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { forwardLog, subscriptions } from '../../db/schema.js';

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
        sourceMessageId: forwardLog.sourceMessageId,
        destMessageId: forwardLog.destMessageId,
        status: forwardLog.status,
        error: forwardLog.error,
        createdAt: forwardLog.createdAt,
      })
      .from(forwardLog)
      .leftJoin(subscriptions, eq(forwardLog.subscriptionId, subscriptions.id))
      .orderBy(desc(forwardLog.createdAt), desc(forwardLog.id))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const hasMore = rows.length > limit;
    const items: ForwardLogEntryDto[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      subscriptionId: row.subscriptionId,
      subscriptionTitle: row.subscriptionTitle,
      sourceMessageId: row.sourceMessageId,
      destMessageId: row.destMessageId,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    }));
    const response: ForwardLogResponse = {
      items,
      nextOffset: hasMore ? offset + limit : null,
    };
    return response;
  });
}
