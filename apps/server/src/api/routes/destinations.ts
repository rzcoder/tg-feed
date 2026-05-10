/**
 * Destinations CRUD routes (Chapter 10).
 *
 * Destinations are the named CRUD list subscriptions pick from. Delete is
 * pre-checked for usage in this layer; the FK is `ON DELETE RESTRICT` as a
 * belt-and-suspenders DB-level guard.
 */
import { asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createDestinationRequestSchema,
  updateDestinationRequestSchema,
  type DestinationDto,
  type DestinationListResponse,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { destinations, subscriptions } from '../../db/schema.js';
import { countWhere } from '../../lib/dbHelpers.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { idParamsSchema } from './_params.js';

interface DestinationRow {
  id: number;
  name: string;
  chatId: string;
  note: string | null;
  createdAt: Date;
  usageCount: number;
}

export interface RegisterDestinationDeps {
  db: Db;
}

export function registerDestinationRoutes(
  app: FastifyInstance,
  deps: RegisterDestinationDeps,
): void {
  const { db } = deps;

  app.get('/destinations', async () => {
    const rows = listDestinations(db);
    const response: DestinationListResponse = { items: rows.map(toDto) };
    return response;
  });

  app.post('/destinations', async (request, reply) => {
    const body = createDestinationRequestSchema.parse(request.body);
    const inserted = db
      .insert(destinations)
      .values({
        name: body.name,
        chatId: body.chatId,
        note: body.note ?? null,
      })
      .returning()
      .all();
    const row = inserted[0]!;
    reply.status(201);
    return toDto({
      id: row.id,
      name: row.name,
      chatId: row.chatId,
      note: row.note,
      createdAt: row.createdAt,
      usageCount: 0,
    });
  });

  app.patch('/destinations/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateDestinationRequestSchema.parse(request.body);
    const updated = db
      .update(destinations)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.chatId !== undefined ? { chatId: body.chatId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      })
      .where(eq(destinations.id, id))
      .returning()
      .all();
    if (updated.length === 0) throw new NotFoundError('destination');
    const row = updated[0]!;
    return toDto({
      id: row.id,
      name: row.name,
      chatId: row.chatId,
      note: row.note,
      createdAt: row.createdAt,
      usageCount: countUsage(db, id),
    });
  });

  app.delete('/destinations/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const usage = countUsage(db, id);
    if (usage > 0) {
      throw new ConflictError(
        `destination is in use by ${usage} subscription${usage === 1 ? '' : 's'}`,
        'destination_in_use',
      );
    }
    const deleted = db.delete(destinations).where(eq(destinations.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('destination');
    reply.status(204);
    return null;
  });
}

function listDestinations(db: Db): DestinationRow[] {
  // One query: destinations LEFT JOIN subscriptions GROUP BY destination,
  // counting subscription references.
  const rows = db
    .select({
      id: destinations.id,
      name: destinations.name,
      chatId: destinations.chatId,
      note: destinations.note,
      createdAt: destinations.createdAt,
      usageCount: count(subscriptions.id).as('usage_count'),
    })
    .from(destinations)
    .leftJoin(subscriptions, eq(subscriptions.destinationId, destinations.id))
    .groupBy(destinations.id)
    .orderBy(asc(destinations.id))
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    chatId: r.chatId,
    note: r.note,
    createdAt: r.createdAt,
    usageCount: Number(r.usageCount ?? 0),
  }));
}

function countUsage(db: Db, destinationId: number): number {
  return countWhere(db, subscriptions, eq(subscriptions.destinationId, destinationId));
}

function toDto(row: DestinationRow): DestinationDto {
  return {
    id: row.id,
    name: row.name,
    chatId: row.chatId,
    note: row.note,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}
