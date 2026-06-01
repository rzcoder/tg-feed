/**
 * Drizzle schema for the tg-feed SQLite database.
 *
 * Telegram chat / message IDs are stored as `text` (lossless, opaque) since
 * they're 64-bit identifiers, not numbers we range-query on.
 *
 * Timestamps: `timestamp_ms` (Date in JS, millis in SQLite). Defaults are
 * applied JS-side via `$defaultFn` — all writes go through drizzle.
 *
 * JSON columns use drizzle's `mode: 'json'` for automatic parse/stringify.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, check, primaryKey } from 'drizzle-orm/sqlite-core';
import {
  FILTER_MODES,
  FILTER_RULE_TYPES,
  FORWARD_LOG_STATUSES,
  type AnyFilterRuleParams,
  type FilterMode,
  type FilterRuleType,
  type ForwardLogStatus,
} from '@tg-feed/shared';

export { FORWARD_LOG_STATUSES, type ForwardLogStatus };

/**
 * Named forward target. Subscriptions pick from this list (Chapter 10).
 * Same chat id can appear under multiple names — unique-by-id, not chatId.
 */
export const destinations = sqliteTable('destinations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  chatId: text('chat_id').notNull(),
  note: text('note'),
  /**
   * Forum topic to forward into, when `chatId` is a forum supergroup. Holds
   * the topic's `top_msg_id`; stored as text for consistency with the other
   * 64-bit ids and converted to a number only at the forward boundary. NULL
   * means "no explicit topic" — the General topic for a forum, or the only
   * behaviour for a normal chat.
   */
  topicId: text('topic_id'),
  /**
   * Topic title cached at create/edit time so the list and badges render
   * without a live `channels.GetForumTopics` round-trip. NULL whenever
   * `topicId` is NULL.
   */
  topicTitle: text('topic_title'),
  /**
   * Channel/chat profile photo as a `data:image/jpeg;base64,...` URL, or
   * NULL when we haven't fetched one yet (the trigger for the access
   * monitor's lazy backfill). Populated on create when Telegram is
   * configured and refreshed by the access monitor on the periodic sweep
   * for rows that are still null.
   */
  iconDataUrl: text('icon_data_url'),
  /**
   * Whether the userbot can currently see/post to this destination. Written
   * by the access monitor (`apps/server/src/tg/accessMonitor.ts`) on the
   * periodic sweep. Default 'ok' so existing rows aren't surfaced as broken
   * before the first sweep runs.
   */
  accessStatus: text('access_status', { enum: ['ok', 'no_access'] })
    .notNull()
    .default('ok')
    .$type<'ok' | 'no_access'>(),
  /** Timestamp of the last access check; null until the first sweep runs. */
  accessCheckedAt: integer('access_checked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceChatId: text('source_chat_id').notNull(),
    sourceTitle: text('source_title').notNull(),
    /**
     * Display handle (`@channel_username`). Populated on create from the
     * resolve endpoint's response; nullable for legacy rows.
     */
    handle: text('handle'),
    /**
     * Source channel profile photo as a `data:image/jpeg;base64,...` URL,
     * or NULL when we haven't fetched one yet. Same lazy-backfill semantics
     * as `destinations.iconDataUrl` — populated on create and refreshed by
     * the access monitor for rows that are still null.
     */
    iconDataUrl: text('icon_data_url'),
    /**
     * FK → destinations. Nullable: a subscription can exist without a
     * destination (created via import where the destination is missing, or
     * detached by the user). The forwarder skips such rows. ON DELETE SET
     * NULL so deleting a destination demotes its subscriptions to detached
     * rather than blocking the delete.
     */
    destinationId: integer('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * Timestamp of the last `CHAT_FORWARDS_RESTRICTED` from this source.
     * Set by the forwarder when Telegram refuses to forward (the channel
     * has "Restrict Saving Content" enabled). Cleared on the next
     * successful forward. Surfaced in the API as `forwardingRestrictedAt`
     * so the UI can render a "noforwards" badge on the subscription.
     */
    forwardingRestrictedAt: integer('forwarding_restricted_at', { mode: 'timestamp_ms' }),
    /**
     * Whether the userbot can currently read messages from this source
     * channel. Written on subscription create (after `channels.JoinChannel`)
     * and on every access-monitor sweep. Default 'ok' so existing rows
     * aren't surfaced as broken before the first sweep runs.
     */
    sourceAccessStatus: text('source_access_status', { enum: ['ok', 'no_access'] })
      .notNull()
      .default('ok')
      .$type<'ok' | 'no_access'>(),
    /** Timestamp of the last access check; null until the first sweep runs. */
    sourceAccessCheckedAt: integer('source_access_checked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    // Listener queries by source_chat_id on every incoming TG message; index
    // turns the per-event lookup from a full scan into an index probe.
    bySourceChatId: index('idx_subscriptions_source_chat_id').on(t.sourceChatId),
  }),
);

export const subscriptionFilters = sqliteTable(
  'subscription_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    ruleType: text('rule_type').notNull().$type<FilterRuleType>(),
    params: text('params', { mode: 'json' }).$type<AnyFilterRuleParams>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * Per-filter mode (Ch 14). 'include' is the legacy default and matches
     * the original AND-pass semantics. 'exclude' inverts the rule for that
     * one row — the filter rejects when its rule matches. SQL CHECK keeps
     * hand-written rows honest, mirroring the `forward_log.status` precedent.
     */
    mode: text('mode').notNull().default('include').$type<FilterMode>(),
  },
  (t) => ({
    bySubscription: index('idx_subscription_filters_sub').on(t.subscriptionId),
    modeCheck: check(
      'subscription_filters_mode_check',
      sql.raw(`mode IN (${FILTER_MODES.map((m) => `'${m}'`).join(', ')})`),
    ),
  }),
);

/**
 * Reusable named filter rules (Chapter 11). Same per-rule params shape as
 * `subscription_filters` but carry a `name` so users can recognise them when
 * attaching across subscriptions. Rule type is constrained both via TS
 * (`$type<FilterRuleType>()`) and a SQL CHECK constraint, mirroring the
 * `forward_log.status` precedent — the TS narrowing alone wouldn't reject
 * a hand-written DB row.
 */
export const libraryFilters = sqliteTable(
  'library_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ruleType: text('rule_type').notNull().$type<FilterRuleType>(),
    params: text('params', { mode: 'json' }).$type<AnyFilterRuleParams>().notNull(),
    /** Same semantics as `subscription_filters.mode`. */
    mode: text('mode').notNull().default('include').$type<FilterMode>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  () => ({
    ruleTypeCheck: check(
      'library_filters_rule_type_check',
      sql.raw(`rule_type IN (${FILTER_RULE_TYPES.map((r) => `'${r}'`).join(', ')})`),
    ),
    modeCheck: check(
      'library_filters_mode_check',
      sql.raw(`mode IN (${FILTER_MODES.map((m) => `'${m}'`).join(', ')})`),
    ),
  }),
);

/**
 * M:N join — a library filter attached to a subscription. No `enabled`
 * column: detach == off, reattach == on, single source of truth (matches
 * the design's "X to detach" affordance).
 *
 * Composite PK on (subscriptionId, libraryFilterId) gives uniqueness
 * automatically; `idx_subscription_library_filters_lib` accelerates the
 * "where used" lookup the library tab needs for usage badges.
 */
export const subscriptionLibraryFilters = sqliteTable(
  'subscription_library_filters',
  {
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    libraryFilterId: integer('library_filter_id')
      .notNull()
      .references(() => libraryFilters.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subscriptionId, t.libraryFilterId] }),
    byLibraryFilter: index('idx_subscription_library_filters_lib').on(t.libraryFilterId),
  }),
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});

/**
 * Single-row table for the Telegram session signed in via the Settings page.
 * Convention: always upserted at id=1 — the table is logically a singleton
 * but uses a normal PK so `onConflictDoUpdate` works without an INSERT/UPDATE
 * branch.
 *
 * `encrypted_session_string` is `base64(iv ‖ tag ‖ ct)` of the raw gramjs
 * `StringSession.save()` value, encrypted with `TG_SESSION_ENCRYPTION_KEY`.
 * `key_fingerprint` is the first 16 hex chars of `sha256(key)` so an
 * exported row can be matched against the importing host's key without
 * exposing either key.
 *
 * Metadata fields (`phone_number`, `display_name`, `username`,
 * `telegram_user_id`) come from `getMe()` after a successful sign-in. They
 * are nullable because the raw-paste flow may produce a session whose
 * `getMe` returns partial data, and because future schema bumps may add
 * fields.
 */
export const telegramAccount = sqliteTable('telegram_account', {
  id: integer('id').primaryKey(),
  encryptedSessionString: text('encrypted_session_string').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  phoneNumber: text('phone_number'),
  displayName: text('display_name'),
  username: text('username'),
  telegramUserId: text('telegram_user_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const forwardLog = sqliteTable(
  'forward_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subscriptionId: integer('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    sourceMessageId: text('source_message_id').notNull(),
    destMessageId: text('dest_message_id'),
    status: text('status', { enum: FORWARD_LOG_STATUSES }).notNull(),
    error: text('error'),
    /**
     * JSON snapshot of the raw gramjs `Message` (captured at the listener /
     * history poller boundary). For album batches every row stores the same
     * N-element array; for single-message forwards a plain object. Nullable
     * for rows written before the column existed (and for `MessageEmpty` /
     * `MessageService` events that we deliberately drop in `toJsonSafe`).
     */
    rawMessage: text('raw_message', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    byCreatedAt: index('idx_forward_log_created_at').on(t.createdAt),
    bySubscription: index('idx_forward_log_subscription').on(t.subscriptionId),
    statusCheck: check(
      'forward_log_status_check',
      sql`${t.status} IN ('sent', 'filtered', 'flood_wait', 'failed')`,
    ),
  }),
);

export type Destination = typeof destinations.$inferSelect;
export type NewDestination = typeof destinations.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type SubscriptionFilter = typeof subscriptionFilters.$inferSelect;
export type NewSubscriptionFilter = typeof subscriptionFilters.$inferInsert;

export type LibraryFilter = typeof libraryFilters.$inferSelect;
export type NewLibraryFilter = typeof libraryFilters.$inferInsert;

export type SubscriptionLibraryFilter = typeof subscriptionLibraryFilters.$inferSelect;
export type NewSubscriptionLibraryFilter = typeof subscriptionLibraryFilters.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type TelegramAccount = typeof telegramAccount.$inferSelect;
export type NewTelegramAccount = typeof telegramAccount.$inferInsert;

export type ForwardLogEntry = typeof forwardLog.$inferSelect;
export type NewForwardLogEntry = typeof forwardLog.$inferInsert;

/**
 * Per-login session row.
 *
 * Replaces the legacy "static cookie value + signed by SESSION_SECRET" scheme
 * with opaque random tokens, so logout actually invalidates a session and a
 * stolen cookie has a single revocation point. The token in the cookie is the
 * primary-key lookup against this table.
 *
 * `expiresAt` is the hard cap; `lastSeenAt` is updated on each authed request
 * for the sliding-window refresh (limits damage from a leaked cookie that
 * sits unused). A background prune sweeps rows past expiry.
 */
export const webSessions = sqliteTable(
  'web_sessions',
  {
    token: text('token').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    byExpiresAt: index('idx_web_sessions_expires_at').on(t.expiresAt),
  }),
);

export type WebSession = typeof webSessions.$inferSelect;
export type NewWebSession = typeof webSessions.$inferInsert;
