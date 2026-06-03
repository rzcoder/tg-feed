import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attachLibraryFilterRequestSchema,
  createSubscriptionRequestSchema,
  resolveSubscriptionRequestSchema,
  updateSubscriptionRequestSchema,
  type InlineFilterInput,
  type ResolveSubscriptionResponse,
  type SubscriptionDto,
  type SubscriptionListResponse,
  type TelegramStatus,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import {
  destinations,
  forwardLog,
  libraryFilters,
  subscriptionFilters,
  subscriptionLibraryFilters,
  subscriptions,
} from '../../db/schema.js';
import type { EventBus } from '../../events/bus.js';
import { assertFilterParamsCompilable } from '../../filters/validateParams.js';
import {
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
  telegramUnavailableError,
} from '../../lib/errors.js';
import type { ChatResolver } from '../../tg/chatResolver.js';
import type { ImportInviteFn } from '../../tg/inviteResolver.js';
import type { JoinChannelFn } from '../../tg/joinChannel.js';
import type { ProfilePhotoFetcher } from '../../tg/profilePhoto.js';
import { idParamsSchema } from './_params.js';

type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const libraryFilterAttachmentParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  libId: z.coerce.number().int().positive(),
});

export interface RegisterSubscriptionDeps {
  db: Db;
  bus: EventBus;
  // Distinguishes "starting up" from "not configured" for the tg-dep error code.
  getTelegramStatus: () => TelegramStatus;
  // Lazy getters: boot fills them asynchronously after `app.listen()`, so read per request.
  getChatResolver?: () => ChatResolver | undefined;
  getImportInvite?: () => ImportInviteFn | undefined;
  // undefined => keep default status; access monitor's first sweep corrects it.
  getJoinChannel?: () => JoinChannelFn | undefined;
  // undefined => iconDataUrl stays null; access monitor backfills later.
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
}

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  deps: RegisterSubscriptionDeps,
): void {
  const {
    db,
    bus,
    getTelegramStatus,
    getChatResolver,
    getImportInvite,
    getJoinChannel,
    getFetchProfilePhoto,
  } = deps;

  app.post('/subscriptions/resolve', async (request) => {
    const chatResolver = getChatResolver?.();
    if (!chatResolver) {
      throw telegramUnavailableError(getTelegramStatus());
    }
    const body = resolveSubscriptionRequestSchema.parse(request.body);
    const resolved = await chatResolver(body.input);
    const response: ResolveSubscriptionResponse = {
      sourceChatId: resolved.chatId,
      sourceTitle: resolved.title,
      handle: resolved.handle,
      inviteHash: resolved.inviteHash,
      alreadyMember: resolved.alreadyMember,
    };
    return response;
  });

  app.get('/subscriptions', async () => {
    const items = listSubscriptions(db);
    const response: SubscriptionListResponse = { items };
    return response;
  });

  app.post('/subscriptions', async (request, reply) => {
    const body = createSubscriptionRequestSchema.parse(request.body);
    // FK SET NULL would coalesce a bad id silently; 400 up-front for a clear UI message.
    if (body.destinationId !== undefined && body.destinationId !== null) {
      const dest = db
        .select()
        .from(destinations)
        .where(eq(destinations.id, body.destinationId))
        .get();
      if (!dest) throw new ValidationError('destination not found');
    }
    if (body.libraryFilterIds && body.libraryFilterIds.length > 0) {
      assertLibraryFiltersExist(db, body.libraryFilterIds);
    }
    // source==destination = forwarding loop (poller re-ingests own forwards); inviteHash re-checked post-join below.
    if (body.sourceChatId !== undefined) {
      const conflict = db
        .select({ id: destinations.id })
        .from(destinations)
        .where(eq(destinations.chatId, body.sourceChatId))
        .get();
      if (conflict) {
        throw new ValidationError(
          'sourceChatId matches an existing destination — would cause a forwarding loop',
        );
      }
    }

    // Invite-hash join is destructive; run it before the insert so a failure leaves no half-baked row.
    let sourceChatId: string;
    let preJoined = false;
    if (body.inviteHash) {
      const importInvite = getImportInvite?.();
      if (!importInvite) {
        throw telegramUnavailableError(getTelegramStatus());
      }
      const join = await importInvite(body.inviteHash);
      if (join.status !== 'ok' || !join.chatId) {
        throw new UpstreamError('failed to join via invite link', 'invite_join_failed');
      }
      sourceChatId = join.chatId;
      preJoined = true;
    } else {
      sourceChatId = body.sourceChatId!;
    }
    // Re-check post-resolve for the loop guard; the join is intentionally not undone.
    {
      const conflict = db
        .select({ id: destinations.id })
        .from(destinations)
        .where(eq(destinations.chatId, sourceChatId))
        .get();
      if (conflict) {
        throw new ValidationError(
          'resolved source chat is also a destination — would cause a forwarding loop',
        );
      }
    }

    const newId = db.transaction((tx) => {
      const inserted = tx
        .insert(subscriptions)
        .values({
          sourceChatId,
          sourceTitle: body.sourceTitle,
          handle: body.handle ?? null,
          destinationId: body.destinationId ?? null,
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        })
        .returning({ id: subscriptions.id })
        .all();
      const row = inserted[0]!;
      if (body.libraryFilterIds && body.libraryFilterIds.length > 0) {
        replaceLibraryFilterAttachments(tx, row.id, body.libraryFilterIds);
      }
      if (body.inlineFilters && body.inlineFilters.length > 0) {
        replaceInlineFilters(tx, row.id, body.inlineFilters);
      }
      return row.id;
    });
    // Outside the tx (gramjs I/O isn't atomic with SQLite) and before the SSE emit so the DTO carries post-join status.
    if (preJoined) {
      db.update(subscriptions)
        .set({ sourceAccessStatus: 'ok', sourceAccessCheckedAt: new Date() })
        .where(eq(subscriptions.id, newId))
        .run();
    } else {
      const joinChannel = getJoinChannel?.();
      if (joinChannel) {
        const status = await joinChannel(sourceChatId);
        db.update(subscriptions)
          .set({ sourceAccessStatus: status, sourceAccessCheckedAt: new Date() })
          .where(eq(subscriptions.id, newId))
          .run();
      }
    }
    // Best-effort; fetcher swallows errors, so the row stays icon-less until backfill.
    const fetchProfilePhoto = getFetchProfilePhoto?.();
    if (fetchProfilePhoto) {
      const iconDataUrl = await fetchProfilePhoto(sourceChatId);
      if (iconDataUrl !== null) {
        db.update(subscriptions).set({ iconDataUrl }).where(eq(subscriptions.id, newId)).run();
      }
    }
    bus.emit({ type: 'subscription.changed', subscriptionId: newId, change: 'created' });
    const dto = getSubscription(db, newId);
    if (!dto) throw new InternalError('subscription disappeared after insert');
    reply.status(201);
    return dto;
  });

  app.patch('/subscriptions/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateSubscriptionRequestSchema.parse(request.body);
    const existing = db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
    if (!existing) throw new NotFoundError('subscription');
    if (body.destinationId !== undefined && body.destinationId !== null) {
      const dest = db
        .select({ id: destinations.id })
        .from(destinations)
        .where(eq(destinations.id, body.destinationId))
        .get();
      if (!dest) throw new ValidationError('destination not found');
    }
    if (body.libraryFilterIds && body.libraryFilterIds.length > 0) {
      assertLibraryFiltersExist(db, body.libraryFilterIds);
    }
    const updateValues = {
      ...(body.sourceTitle !== undefined ? { sourceTitle: body.sourceTitle } : {}),
      ...(body.destinationId !== undefined ? { destinationId: body.destinationId } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    };
    db.transaction((tx) => {
      if (Object.keys(updateValues).length > 0) {
        tx.update(subscriptions).set(updateValues).where(eq(subscriptions.id, id)).run();
      }
      if (body.libraryFilterIds !== undefined) {
        replaceLibraryFilterAttachments(tx, id, body.libraryFilterIds);
      }
      if (body.inlineFilters !== undefined) {
        replaceInlineFilters(tx, id, body.inlineFilters);
      }
    });
    bus.emit({ type: 'subscription.changed', subscriptionId: id, change: 'updated' });
    const dto = getSubscription(db, id);
    if (!dto) throw new InternalError('subscription disappeared after update');
    return dto;
  });

  app.delete('/subscriptions/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const deleted = db.delete(subscriptions).where(eq(subscriptions.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('subscription');
    bus.emit({ type: 'subscription.changed', subscriptionId: id, change: 'deleted' });
    reply.status(204);
    return null;
  });

  app.post('/subscriptions/:id/library-filters', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = attachLibraryFilterRequestSchema.parse(request.body);
    const sub = db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .get();
    if (!sub) throw new NotFoundError('subscription');
    const lib = db
      .select({ id: libraryFilters.id })
      .from(libraryFilters)
      .where(eq(libraryFilters.id, body.libraryFilterId))
      .get();
    if (!lib) throw new NotFoundError('library filter');
    db.insert(subscriptionLibraryFilters)
      .values({ subscriptionId: id, libraryFilterId: body.libraryFilterId })
      .onConflictDoNothing()
      .run();
    bus.emit({ type: 'subscription.changed', subscriptionId: id, change: 'updated' });
    const dto = getSubscription(db, id);
    if (!dto) throw new InternalError('subscription disappeared after attach');
    reply.status(201);
    return dto;
  });

  app.delete('/subscriptions/:id/library-filters/:libId', async (request, reply) => {
    const { id, libId } = libraryFilterAttachmentParamsSchema.parse(request.params);
    const result = db
      .delete(subscriptionLibraryFilters)
      .where(
        and(
          eq(subscriptionLibraryFilters.subscriptionId, id),
          eq(subscriptionLibraryFilters.libraryFilterId, libId),
        ),
      )
      .run();
    if (result.changes === 0) {
      throw new NotFoundError('subscription library filter attachment');
    }
    bus.emit({ type: 'subscription.changed', subscriptionId: id, change: 'updated' });
    reply.status(204);
    return null;
  });
}

interface SubscriptionListRow {
  id: number;
  sourceChatId: string;
  sourceTitle: string;
  handle: string | null;
  iconDataUrl: string | null;
  destinationId: number | null;
  destinationName: string | null;
  destinationChatId: string | null;
  enabled: boolean;
  forwardingRestrictedAt: Date | null;
  sourceAccessStatus: 'ok' | 'no_access';
  sourceAccessCheckedAt: Date | null;
  destinationAccessStatus: 'ok' | 'no_access' | null;
  createdAt: Date;
  filterCount: number;
  forwardedCount: number;
}

function assertLibraryFiltersExist(db: DbOrTx, ids: readonly number[]): void {
  if (ids.length === 0) return;
  const found = db
    .select({ id: libraryFilters.id })
    .from(libraryFilters)
    .where(inArray(libraryFilters.id, [...ids]))
    .all();
  const foundSet = new Set(found.map((r) => r.id));
  const missing = ids.filter((id) => !foundSet.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`unknown library filter ids: ${missing.join(', ')}`);
  }
}

export function replaceLibraryFilterAttachments(
  db: DbOrTx,
  subscriptionId: number,
  libraryFilterIds: readonly number[],
): void {
  db.delete(subscriptionLibraryFilters)
    .where(eq(subscriptionLibraryFilters.subscriptionId, subscriptionId))
    .run();
  if (libraryFilterIds.length === 0) return;
  db.insert(subscriptionLibraryFilters)
    .values(libraryFilterIds.map((libraryFilterId) => ({ subscriptionId, libraryFilterId })))
    .run();
}

// Empty array = drop all. Inputs are pre-validated as a discriminated union (params match ruleType).
export function replaceInlineFilters(
  db: DbOrTx,
  subscriptionId: number,
  inputs: readonly InlineFilterInput[],
): void {
  db.delete(subscriptionFilters)
    .where(eq(subscriptionFilters.subscriptionId, subscriptionId))
    .run();
  if (inputs.length === 0) return;
  for (const f of inputs) assertFilterParamsCompilable(f.ruleType, f.params);
  db.insert(subscriptionFilters)
    .values(
      inputs.map((f) => ({
        subscriptionId,
        ruleType: f.ruleType,
        params: f.params,
        ...(f.enabled !== undefined ? { enabled: f.enabled } : {}),
        ...(f.mode !== undefined ? { mode: f.mode } : {}),
      })),
    )
    .run();
}

function loadLibraryFilterIds(db: Db, subscriptionId: number): number[] {
  const rows = db
    .select({ id: subscriptionLibraryFilters.libraryFilterId })
    .from(subscriptionLibraryFilters)
    .where(eq(subscriptionLibraryFilters.subscriptionId, subscriptionId))
    .orderBy(asc(subscriptionLibraryFilters.libraryFilterId))
    .all();
  return rows.map((r) => r.id);
}

function loadLibraryFilterIdsBatch(db: Db, subscriptionIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>();
  for (const id of subscriptionIds) result.set(id, []);
  if (subscriptionIds.length === 0) return result;
  const rows = db
    .select({
      subscriptionId: subscriptionLibraryFilters.subscriptionId,
      libraryFilterId: subscriptionLibraryFilters.libraryFilterId,
    })
    .from(subscriptionLibraryFilters)
    .where(inArray(subscriptionLibraryFilters.subscriptionId, subscriptionIds))
    .orderBy(asc(subscriptionLibraryFilters.libraryFilterId))
    .all();
  for (const row of rows) {
    result.get(row.subscriptionId)?.push(row.libraryFilterId);
  }
  return result;
}

// filterCount = per-sub filter rows (any enabled state) + library attachments.
const filterCountSubquery = sql<number>`(
  SELECT COUNT(*) FROM ${subscriptionFilters}
  WHERE ${subscriptionFilters.subscriptionId} = ${subscriptions.id}
) + (
  SELECT COUNT(*) FROM ${subscriptionLibraryFilters}
  WHERE ${subscriptionLibraryFilters.subscriptionId} = ${subscriptions.id}
)`;
const forwardedCountSubquery = sql<number>`(
  SELECT COUNT(*) FROM ${forwardLog}
  WHERE ${forwardLog.subscriptionId} = ${subscriptions.id}
    AND ${forwardLog.status} = 'sent'
)`;
const subscriptionListColumns = {
  id: subscriptions.id,
  sourceChatId: subscriptions.sourceChatId,
  sourceTitle: subscriptions.sourceTitle,
  handle: subscriptions.handle,
  iconDataUrl: subscriptions.iconDataUrl,
  destinationId: subscriptions.destinationId,
  destinationName: destinations.name,
  destinationChatId: destinations.chatId,
  enabled: subscriptions.enabled,
  forwardingRestrictedAt: subscriptions.forwardingRestrictedAt,
  sourceAccessStatus: subscriptions.sourceAccessStatus,
  sourceAccessCheckedAt: subscriptions.sourceAccessCheckedAt,
  destinationAccessStatus: destinations.accessStatus,
  createdAt: subscriptions.createdAt,
  filterCount: filterCountSubquery,
  forwardedCount: forwardedCountSubquery,
};

function listSubscriptions(db: Db): SubscriptionDto[] {
  const rows = db
    .select(subscriptionListColumns)
    .from(subscriptions)
    .leftJoin(destinations, eq(subscriptions.destinationId, destinations.id))
    .orderBy(asc(subscriptions.id))
    .all();
  const libIdsBySub = loadLibraryFilterIdsBatch(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDto(r as SubscriptionListRow, libIdsBySub.get(r.id) ?? []));
}

export function getSubscription(db: Db, id: number): SubscriptionDto | undefined {
  const row = db
    .select(subscriptionListColumns)
    .from(subscriptions)
    .leftJoin(destinations, eq(subscriptions.destinationId, destinations.id))
    .where(eq(subscriptions.id, id))
    .get();
  if (!row) return undefined;
  return toDto(row as SubscriptionListRow, loadLibraryFilterIds(db, id));
}

function toDto(row: SubscriptionListRow, libraryFilterIds: number[]): SubscriptionDto {
  return {
    id: row.id,
    sourceChatId: row.sourceChatId,
    sourceTitle: row.sourceTitle,
    handle: row.handle,
    iconDataUrl: row.iconDataUrl,
    destinationId: row.destinationId,
    destinationName: row.destinationName,
    destinationChatId: row.destinationChatId,
    enabled: row.enabled,
    filterCount: Number(row.filterCount ?? 0),
    forwardedCount: Number(row.forwardedCount ?? 0),
    libraryFilterIds,
    forwardingRestrictedAt: row.forwardingRestrictedAt
      ? row.forwardingRestrictedAt.toISOString()
      : null,
    sourceAccessStatus: row.sourceAccessStatus,
    sourceAccessCheckedAt: row.sourceAccessCheckedAt
      ? row.sourceAccessCheckedAt.toISOString()
      : null,
    destinationAccessStatus: row.destinationAccessStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
