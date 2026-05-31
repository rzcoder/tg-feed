/**
 * Subscription CRUD + resolve routes.
 *
 * `sourceChatId` and `handle` are immutable post-creation (matches the
 * shared schema's `updateSubscriptionRequestSchema`); to change the source
 * channel, delete and recreate.
 *
 * DELETE returns 204 No Content (REST convention). Cascades down to
 * `subscription_filters` and `subscription_library_filters` (Ch 11);
 * `forward_log` rows survive with `subscriptionId` set to NULL via
 * `ON DELETE SET NULL` (Ch 2).
 *
 * The resolve endpoint is preview-only — it never writes to the DB. The
 * UI submits the resolved fields back to POST /subscriptions to commit.
 * Routes that need the gramjs entity resolver gate on its presence and
 * return 503 — `telegram_initializing` while the Telegram subsystem is
 * still bootstrapping (background init in `apps/server/src/index.ts`),
 * `telegram_unavailable` once it's settled in a disconnected state (test
 * mode, missing Telegram env). The web UI keys on the code: the first is
 * a transient retry; the second points the operator at configuration.
 *
 * Library filter attachments are exposed two ways:
 * - bulk-replace via `libraryFilterIds` on POST/PATCH /subscriptions[/:id]
 *   (used by the SubSheet's checkbox group)
 * - granular at POST /:id/library-filters and DELETE /:id/library-filters/:libId
 *   (used by the per-sub Filters view's `+` and `X` buttons)
 *
 * Inline (private) filters work the same way: bulk-replace via
 * `inlineFilters` on POST/PATCH /subscriptions[/:id], plus the granular
 * CRUD at /:id/filters[/:filterId] in `filters.ts`. Both library and
 * inline writes happen inside a single `db.transaction(...)` so a partial
 * failure can't leave the subscription with one set replaced and the other
 * untouched.
 */
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

// `db.transaction(cb)` passes `cb` a tx handle whose query interface matches
// `Db`'s, but its TS type is the more specific `SQLiteTransaction`. Helpers
// that need to run under either branch take this union.
type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const libraryFilterAttachmentParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  libId: z.coerce.number().int().positive(),
});

export interface RegisterSubscriptionDeps {
  db: Db;
  bus: EventBus;
  /**
   * Live status getter used to distinguish "Telegram is starting up — try
   * again in a moment" from "Telegram is not configured at all". Drives
   * the error code returned when a tg-dep getter yields undefined.
   */
  getTelegramStatus: () => TelegramStatus;
  /**
   * Lazy lookup for the universal "paste-anything" resolver — backs
   * `POST /subscriptions/resolve`. Read per request because the boot path
   * fills it asynchronously after `app.listen()`. Accepts any of:
   * `@username`, `t.me/username`, `t.me/+HASH`, `+HASH`, or numeric chat id.
   */
  getChatResolver?: () => ChatResolver | undefined;
  /**
   * Lazy lookup for the `messages.ImportChatInvite` wrapper invoked from
   * `POST /subscriptions` when the body carries `inviteHash`. Same
   * lifecycle as `getChatResolver`.
   */
  getImportInvite?: () => ImportInviteFn | undefined;
  /**
   * Lazy lookup for the auto-join helper invoked after a successful
   * POST /subscriptions insert (chatId path). When the getter yields
   * undefined the row keeps the default 'ok' status and the access
   * monitor's first sweep corrects it. The `inviteHash` path bypasses
   * this — `importInvite` already joined.
   */
  getJoinChannel?: () => JoinChannelFn | undefined;
  /**
   * Lazy lookup for the best-effort profile-photo fetcher invoked after
   * the row is inserted. When undefined the row's `iconDataUrl` stays
   * null and the access monitor's lazy backfill catches it later.
   */
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
    // `destinationId` is now optional/nullable — only validate when provided.
    // FK SET NULL would coalesce a bad id silently, so we still 400 up-front
    // for a missing one to surface a clear UI message.
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
    // Source==destination guard. A subscription whose source chat id is also
    // a destination chat id would forward into itself: the bot's own forwards
    // would (via the history poller, which bypasses the `incoming:true`
    // filter on the live listener) be re-ingested and forwarded again on the
    // next sweep, ad infinitum. Reject up-front; safe to skip when the body
    // uses an `inviteHash` since we don't know the chat id until after join,
    // and the post-join shape is checked below.
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

    // Resolve the source chat id from either the resolved id (existing flow)
    // or by joining via invite hash (new flow). The hash path is destructive
    // and runs *before* the insert so a join failure doesn't leave a
    // half-baked row behind.
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
    // Re-check post-resolve in case the invite path landed on a chat that is
    // already a destination. (Same loop-prevention rationale as above.) We
    // intentionally don't undo the join — at this point the bot has joined
    // the channel; the operator just can't use it as a subscription with
    // that destination configuration.
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
    // For the chatId path: auto-join the source channel so the userbot
    // starts receiving its events. Done outside the transaction (gramjs
    // network I/O can't be atomic with SQLite) and before the SSE emit so
    // the DTO read by the UI carries the post-join status.
    if (preJoined) {
      // Already joined via importInvite; just stamp the access check.
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
    // Best-effort profile photo fetch. Same reasoning as on the
    // destination create path: the fetcher swallows errors and returns
    // null, so failure means the row stays icon-less until the access
    // monitor's lazy backfill kicks in.
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

  /** Granular attach — backs the per-sub view's `+ library filter` action. */
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

  /** Granular detach — the design's "X" button on attached library chips. */
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

// Bulk-replace the private inline filter set for a subscription. The input
// array has already been zod-validated as a discriminated union, so each
// element's `params` is guaranteed to match its `ruleType`. Empty array =
// drop all (matches `replaceLibraryFilterAttachments` semantics).
export function replaceInlineFilters(
  db: DbOrTx,
  subscriptionId: number,
  inputs: readonly InlineFilterInput[],
): void {
  db.delete(subscriptionFilters)
    .where(eq(subscriptionFilters.subscriptionId, subscriptionId))
    .run();
  if (inputs.length === 0) return;
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

// Correlated subqueries reused by listSubscriptions/getSubscription.
// `filterCount` is the sum of per-sub filter rows (regardless of enabled —
// same as Ch 7) plus library-filter attachments. Both are cheap on SQLite.
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
