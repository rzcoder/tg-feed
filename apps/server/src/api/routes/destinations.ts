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
  listForumTopicsRequestSchema,
  resolveDestinationRequestSchema,
  updateDestinationRequestSchema,
  type DestinationDto,
  type DestinationListResponse,
  type ListForumTopicsResponse,
  type ResolveDestinationResponse,
  type TelegramStatus,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { destinations, subscriptions } from '../../db/schema.js';
import { countWhere } from '../../lib/dbHelpers.js';
import {
  ConflictError,
  NotFoundError,
  UpstreamError,
  telegramUnavailableError,
} from '../../lib/errors.js';
import type { ChatResolver } from '../../tg/chatResolver.js';
import type { ForumTopicLister } from '../../tg/forumTopics.js';
import type { ImportInviteFn } from '../../tg/inviteResolver.js';
import type { ProfilePhotoFetcher } from '../../tg/profilePhoto.js';
import { idParamsSchema } from './_params.js';

interface DestinationRow {
  id: number;
  name: string;
  chatId: string;
  note: string | null;
  topicId: string | null;
  topicTitle: string | null;
  iconDataUrl: string | null;
  accessStatus: 'ok' | 'no_access';
  accessCheckedAt: Date | null;
  createdAt: Date;
  usageCount: number;
}

export interface RegisterDestinationDeps {
  db: Db;
  /**
   * Live status getter used to distinguish "Telegram is starting up — try
   * again in a moment" from "Telegram is not configured at all". Drives
   * the error code returned when a tg-dep getter yields undefined.
   */
  getTelegramStatus: () => TelegramStatus;
  /**
   * Lazy lookup for the universal "paste-anything" resolver — backs
   * `POST /destinations/resolve`. Read per request because the boot path
   * fills it asynchronously after `app.listen()`. When undefined the
   * route returns 503 with `telegram_initializing` (during the boot
   * window) or `telegram_unavailable` (steady-state disconnected).
   */
  getChatResolver?: () => ChatResolver | undefined;
  /**
   * Lazy lookup for the `messages.ImportChatInvite` wrapper invoked from
   * `POST /destinations` when the body carries `inviteHash`. Same
   * lifecycle as `getChatResolver`.
   */
  getImportInvite?: () => ImportInviteFn | undefined;
  /**
   * Lazy lookup for the best-effort profile-photo fetcher invoked after
   * the row is inserted. When undefined the row's `iconDataUrl` stays
   * null and the access monitor's lazy backfill catches it later.
   */
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
  /**
   * Lazy lookup for the forum-topic lister backing `POST /destinations/topics`.
   * Same lifecycle as `getChatResolver`. When undefined the route returns 503.
   */
  getListForumTopics?: () => ForumTopicLister | undefined;
}

export function registerDestinationRoutes(
  app: FastifyInstance,
  deps: RegisterDestinationDeps,
): void {
  const {
    db,
    getTelegramStatus,
    getChatResolver,
    getImportInvite,
    getFetchProfilePhoto,
    getListForumTopics,
  } = deps;

  app.get('/destinations', async () => {
    const rows = listDestinations(db);
    const response: DestinationListResponse = { items: rows.map(toDto) };
    return response;
  });

  app.post('/destinations/resolve', async (request) => {
    const chatResolver = getChatResolver?.();
    if (!chatResolver) {
      throw telegramUnavailableError(getTelegramStatus());
    }
    const body = resolveDestinationRequestSchema.parse(request.body);
    const resolved = await chatResolver(body.input);
    const response: ResolveDestinationResponse = {
      chatId: resolved.chatId,
      title: resolved.title,
      handle: resolved.handle,
      inviteHash: resolved.inviteHash,
      alreadyMember: resolved.alreadyMember,
      isForum: resolved.isForum,
    };
    return response;
  });

  app.post('/destinations/topics', async (request) => {
    const listForumTopics = getListForumTopics?.();
    if (!listForumTopics) {
      throw telegramUnavailableError(getTelegramStatus());
    }
    const body = listForumTopicsRequestSchema.parse(request.body);
    const { isForum, topics } = await listForumTopics(body.chatId);
    const response: ListForumTopicsResponse = { isForum, topics };
    return response;
  });

  app.post('/destinations', async (request, reply) => {
    const body = createDestinationRequestSchema.parse(request.body);

    let chatId: string;
    let initialAccessStatus: 'ok' | 'no_access' = 'ok';
    let accessCheckedAt: Date | null = null;
    if (body.inviteHash) {
      const importInvite = getImportInvite?.();
      if (!importInvite) {
        throw telegramUnavailableError(getTelegramStatus());
      }
      const join = await importInvite(body.inviteHash);
      if (join.status !== 'ok' || !join.chatId) {
        throw new UpstreamError('failed to join via invite link', 'invite_join_failed');
      }
      chatId = join.chatId;
      // We just successfully joined — record access ok now so the access
      // monitor's first sweep doesn't briefly mis-report.
      initialAccessStatus = 'ok';
      accessCheckedAt = new Date();
    } else {
      // Schema refine guarantees one of inviteHash/chatId is set.
      chatId = body.chatId!;
    }

    const inserted = db
      .insert(destinations)
      .values({
        name: body.name,
        chatId,
        note: body.note ?? null,
        topicId: body.topicId ?? null,
        topicTitle: body.topicTitle ?? null,
        ...(accessCheckedAt ? { accessStatus: initialAccessStatus, accessCheckedAt } : {}),
      })
      .returning()
      .all();
    const row = inserted[0]!;
    // Best-effort: fetch the profile photo and stamp it on the row. The
    // fetcher already swallows errors and returns null on failure, so we
    // don't need a try/catch — the response just goes out without an icon.
    let iconDataUrl: string | null = row.iconDataUrl;
    const fetchProfilePhoto = getFetchProfilePhoto?.();
    if (fetchProfilePhoto) {
      iconDataUrl = await fetchProfilePhoto(chatId);
      if (iconDataUrl !== null) {
        db.update(destinations).set({ iconDataUrl }).where(eq(destinations.id, row.id)).run();
      }
    }
    reply.status(201);
    return toDto({
      id: row.id,
      name: row.name,
      chatId: row.chatId,
      note: row.note,
      topicId: row.topicId,
      topicTitle: row.topicTitle,
      iconDataUrl,
      accessStatus: row.accessStatus,
      accessCheckedAt: row.accessCheckedAt,
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
        ...(body.topicId !== undefined ? { topicId: body.topicId } : {}),
        ...(body.topicTitle !== undefined ? { topicTitle: body.topicTitle } : {}),
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
      topicId: row.topicId,
      topicTitle: row.topicTitle,
      iconDataUrl: row.iconDataUrl,
      accessStatus: row.accessStatus,
      accessCheckedAt: row.accessCheckedAt,
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
      topicId: destinations.topicId,
      topicTitle: destinations.topicTitle,
      iconDataUrl: destinations.iconDataUrl,
      accessStatus: destinations.accessStatus,
      accessCheckedAt: destinations.accessCheckedAt,
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
    topicId: r.topicId,
    topicTitle: r.topicTitle,
    iconDataUrl: r.iconDataUrl,
    accessStatus: r.accessStatus,
    accessCheckedAt: r.accessCheckedAt,
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
    topicId: row.topicId,
    topicTitle: row.topicTitle,
    iconDataUrl: row.iconDataUrl,
    usageCount: row.usageCount,
    accessStatus: row.accessStatus,
    accessCheckedAt: row.accessCheckedAt ? row.accessCheckedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
