import { asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createLibraryFilterRequestSchema,
  filterRuleParamsSchemas,
  updateLibraryFilterRequestSchema,
  type FilterMode,
  type LibraryFilterDto,
  type LibraryFilterListResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { libraryFilters, subscriptionLibraryFilters } from '../../db/schema.js';
import { countWhere } from '../../lib/dbHelpers.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { assertFilterParamsCompilable } from '../../filters/validateParams.js';
import { idParamsSchema } from './_params.js';

interface LibraryFilterRow {
  id: number;
  name: string;
  ruleType: LibraryFilterDto['ruleType'];
  params: Record<string, unknown>;
  mode: FilterMode;
  createdAt: Date;
  usageCount: number;
}

export interface RegisterLibraryFilterDeps {
  db: Db;
}

export function registerLibraryFilterRoutes(
  app: FastifyInstance,
  deps: RegisterLibraryFilterDeps,
): void {
  const { db } = deps;

  app.get('/library-filters', async () => {
    const rows = listLibraryFilters(db);
    const response: LibraryFilterListResponse = { items: rows.map(toDto) };
    return response;
  });

  app.post('/library-filters', async (request, reply) => {
    const body = createLibraryFilterRequestSchema.parse(request.body);
    assertFilterParamsCompilable(body.ruleType, body.params);
    const inserted = db
      .insert(libraryFilters)
      .values({
        name: body.name,
        ruleType: body.ruleType,
        params: body.params,
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
      })
      .returning()
      .all();
    const row = inserted[0]!;
    reply.status(201);
    return toDto({
      id: row.id,
      name: row.name,
      ruleType: row.ruleType,
      params: row.params,
      mode: row.mode,
      createdAt: row.createdAt,
      usageCount: 0,
    });
  });

  app.patch('/library-filters/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateLibraryFilterRequestSchema.parse(request.body);
    // ruleType is immutable; needed to pick the params schema for validation.
    const existing = db.select().from(libraryFilters).where(eq(libraryFilters.id, id)).get();
    if (!existing) throw new NotFoundError('library filter');

    let validatedParams = existing.params;
    if (body.params !== undefined) {
      const paramsSchema = filterRuleParamsSchemas[existing.ruleType];
      const result = paramsSchema.safeParse(body.params);
      if (!result.success) {
        throw new ValidationError('invalid params for rule type', result.error.issues);
      }
      validatedParams = result.data;
      assertFilterParamsCompilable(existing.ruleType, validatedParams);
    }

    const updated = db
      .update(libraryFilters)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.params !== undefined ? { params: validatedParams } : {}),
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
      })
      .where(eq(libraryFilters.id, id))
      .returning()
      .all();
    const row = updated[0]!;
    return toDto({
      id: row.id,
      name: row.name,
      ruleType: row.ruleType,
      params: row.params,
      mode: row.mode,
      createdAt: row.createdAt,
      usageCount: countUsage(db, id),
    });
  });

  app.delete('/library-filters/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const usage = countUsage(db, id);
    if (usage > 0) {
      throw new ConflictError(
        `library filter is in use by ${usage} subscription${usage === 1 ? '' : 's'}`,
        'library_filter_in_use',
      );
    }
    const deleted = db.delete(libraryFilters).where(eq(libraryFilters.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('library filter');
    reply.status(204);
    return null;
  });
}

function listLibraryFilters(db: Db): LibraryFilterRow[] {
  const rows = db
    .select({
      id: libraryFilters.id,
      name: libraryFilters.name,
      ruleType: libraryFilters.ruleType,
      params: libraryFilters.params,
      mode: libraryFilters.mode,
      createdAt: libraryFilters.createdAt,
      usageCount: count(subscriptionLibraryFilters.subscriptionId).as('usage_count'),
    })
    .from(libraryFilters)
    .leftJoin(
      subscriptionLibraryFilters,
      eq(subscriptionLibraryFilters.libraryFilterId, libraryFilters.id),
    )
    .groupBy(libraryFilters.id)
    .orderBy(asc(libraryFilters.id))
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ruleType: r.ruleType,
    params: r.params,
    mode: r.mode,
    createdAt: r.createdAt,
    usageCount: Number(r.usageCount ?? 0),
  }));
}

function countUsage(db: Db, libraryFilterId: number): number {
  return countWhere(
    db,
    subscriptionLibraryFilters,
    eq(subscriptionLibraryFilters.libraryFilterId, libraryFilterId),
  );
}

function toDto(row: LibraryFilterRow): LibraryFilterDto {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.ruleType,
    params: row.params,
    mode: row.mode,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}
