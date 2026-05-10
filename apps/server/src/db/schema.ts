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
  FILTER_RULE_TYPES,
  FORWARD_LOG_STATUSES,
  type AnyFilterRuleParams,
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
     * FK → destinations. ON DELETE RESTRICT — server pre-checks usage and
     * returns ConflictError before delete; the FK is belt-and-suspenders.
     */
    destinationId: integer('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'restrict' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
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
  },
  (t) => ({
    bySubscription: index('idx_subscription_filters_sub').on(t.subscriptionId),
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  () => ({
    ruleTypeCheck: check(
      'library_filters_rule_type_check',
      sql.raw(`rule_type IN (${FILTER_RULE_TYPES.map((r) => `'${r}'`).join(', ')})`),
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

export const tgSession = sqliteTable('tg_session', {
  key: text('key').primaryKey(),
  encryptedString: text('encrypted_string').notNull(),
});

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

export type ForwardLogEntry = typeof forwardLog.$inferSelect;
export type NewForwardLogEntry = typeof forwardLog.$inferInsert;

export type TgSession = typeof tgSession.$inferSelect;
export type NewTgSession = typeof tgSession.$inferInsert;
