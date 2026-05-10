/**
 * Filter routes — catalog + per-subscription filter CRUD.
 *
 * The catalog (`GET /api/filters/catalog`) reflects what's actually
 * registered in the live filter registry — not a hardcoded list. Adding
 * a rule = drop a file + register it in `createDefaultRegistry()`; the
 * catalog endpoint picks it up on next restart.
 *
 * Filter PATCH validates `params` against the EXISTING row's `ruleType`
 * (rule type itself is immutable post-creation; to switch, delete and
 * re-add). The shared schema's `updateSubscriptionFilterRequestSchema`
 * keeps `params` loose (`z.record`); strict per-rule validation happens
 * here in the handler.
 *
 * Cross-sub access (filter id belongs to a different sub than the URL
 * names) returns 404 — prevents id-guessing across subscriptions.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSubscriptionFilterRequestSchema,
  filterRuleParamsSchemas,
  updateSubscriptionFilterRequestSchema,
  type FilterRuleCatalogEntry,
  type FilterRuleCatalogResponse,
  type SubscriptionFilterDto,
  type SubscriptionFilterListResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { subscriptionFilters, subscriptions, type SubscriptionFilter } from '../../db/schema.js';
import type { FilterRegistry } from '../../filters/registry.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { idParamsSchema } from './_params.js';

const filterIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  filterId: z.coerce.number().int().positive(),
});

export interface RegisterFilterDeps {
  db: Db;
  filterRegistry: FilterRegistry;
}

export function registerFilterRoutes(app: FastifyInstance, deps: RegisterFilterDeps): void {
  const { db, filterRegistry } = deps;

  app.get('/filters/catalog', async () => {
    const items: FilterRuleCatalogEntry[] = filterRegistry
      .listRules()
      .map((rule) => ({ type: rule.type, label: rule.label }));
    const response: FilterRuleCatalogResponse = { items };
    return response;
  });

  app.get('/subscriptions/:id/filters', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    requireSubscription(db, id);
    const rows = db
      .select()
      .from(subscriptionFilters)
      .where(eq(subscriptionFilters.subscriptionId, id))
      .orderBy(asc(subscriptionFilters.id))
      .all();
    const response: SubscriptionFilterListResponse = { items: rows.map(toDto) };
    return response;
  });

  app.post('/subscriptions/:id/filters', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    requireSubscription(db, id);
    const body = createSubscriptionFilterRequestSchema.parse(request.body);
    const inserted = db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: id,
        ruleType: body.ruleType,
        params: body.params,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
      })
      .returning()
      .all();
    reply.status(201);
    return toDto(inserted[0]!);
  });

  app.patch('/subscriptions/:id/filters/:filterId', async (request) => {
    const { id, filterId } = filterIdParamsSchema.parse(request.params);
    const body = updateSubscriptionFilterRequestSchema.parse(request.body);
    const existing = findFilter(db, id, filterId);

    const patch: Partial<SubscriptionFilter> = {};
    if (body.params !== undefined) {
      const schema = filterRuleParamsSchemas[existing.ruleType];
      const parsed = schema.safeParse(body.params);
      if (!parsed.success) {
        throw new ValidationError(`invalid params for ${existing.ruleType}`, parsed.error.issues);
      }
      patch.params = parsed.data;
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.mode !== undefined) patch.mode = body.mode;

    const updated = db
      .update(subscriptionFilters)
      .set(patch)
      .where(eq(subscriptionFilters.id, filterId))
      .returning()
      .all();
    return toDto(updated[0]!);
  });

  app.delete('/subscriptions/:id/filters/:filterId', async (request, reply) => {
    const { id, filterId } = filterIdParamsSchema.parse(request.params);
    findFilter(db, id, filterId);
    db.delete(subscriptionFilters).where(eq(subscriptionFilters.id, filterId)).run();
    reply.status(204);
    return null;
  });
}

function requireSubscription(db: Db, subscriptionId: number): void {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).get();
  if (!sub) throw new NotFoundError('subscription');
}

function findFilter(db: Db, subscriptionId: number, filterId: number): SubscriptionFilter {
  const row = db
    .select()
    .from(subscriptionFilters)
    .where(
      and(
        eq(subscriptionFilters.id, filterId),
        eq(subscriptionFilters.subscriptionId, subscriptionId),
      ),
    )
    .get();
  if (!row) throw new NotFoundError('filter');
  return row;
}

function toDto(row: SubscriptionFilter): SubscriptionFilterDto {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    ruleType: row.ruleType,
    params: row.params as Record<string, unknown>,
    enabled: row.enabled,
    mode: row.mode,
  };
}
