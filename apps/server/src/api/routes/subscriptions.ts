/**
 * Subscription CRUD routes.
 *
 * `sourceChatId` is immutable post-creation (matches the shared schema's
 * `updateSubscriptionRequestSchema`); to change it, delete and recreate.
 *
 * DELETE returns 204 No Content (REST convention) and cascades down to
 * `subscription_filters` rows; `forward_log` rows survive with
 * `subscriptionId` set to NULL (FK `ON DELETE SET NULL`, defined in
 * `db/schema.ts`).
 */
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSubscriptionRequestSchema,
  updateSubscriptionRequestSchema,
  type SubscriptionDto,
  type SubscriptionListResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { subscriptions, type Subscription } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';

const subscriptionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export interface RegisterSubscriptionDeps {
  db: Db;
}

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  deps: RegisterSubscriptionDeps,
): void {
  const { db } = deps;

  app.get('/subscriptions', async () => {
    const rows = db.select().from(subscriptions).orderBy(asc(subscriptions.id)).all();
    const response: SubscriptionListResponse = { items: rows.map(toDto) };
    return response;
  });

  app.post('/subscriptions', async (request, reply) => {
    const body = createSubscriptionRequestSchema.parse(request.body);
    const inserted = db
      .insert(subscriptions)
      .values({
        sourceChatId: body.sourceChatId,
        sourceTitle: body.sourceTitle,
        destinationChatId: body.destinationChatId,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      })
      .returning()
      .all();
    reply.status(201);
    return toDto(inserted[0]!);
  });

  app.patch('/subscriptions/:id', async (request) => {
    const { id } = subscriptionIdParamsSchema.parse(request.params);
    const body = updateSubscriptionRequestSchema.parse(request.body);
    const existing = db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
    if (!existing) throw new NotFoundError('subscription');
    const updated = db
      .update(subscriptions)
      .set(body)
      .where(eq(subscriptions.id, id))
      .returning()
      .all();
    return toDto(updated[0]!);
  });

  app.delete('/subscriptions/:id', async (request, reply) => {
    const { id } = subscriptionIdParamsSchema.parse(request.params);
    const deleted = db.delete(subscriptions).where(eq(subscriptions.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('subscription');
    reply.status(204);
    return null;
  });
}

function toDto(row: Subscription): SubscriptionDto {
  return {
    id: row.id,
    sourceChatId: row.sourceChatId,
    sourceTitle: row.sourceTitle,
    destinationChatId: row.destinationChatId,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}
