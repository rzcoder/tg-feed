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
import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import {
  FORWARD_LOG_STATUSES,
  type AnyFilterRuleParams,
  type FilterRuleType,
  type ForwardLogStatus,
} from '@tg-feed/shared';

export { FORWARD_LOG_STATUSES, type ForwardLogStatus };

export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceChatId: text('source_chat_id').notNull(),
  sourceTitle: text('source_title').notNull(),
  destinationChatId: text('destination_chat_id').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

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

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type SubscriptionFilter = typeof subscriptionFilters.$inferSelect;
export type NewSubscriptionFilter = typeof subscriptionFilters.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type ForwardLogEntry = typeof forwardLog.$inferSelect;
export type NewForwardLogEntry = typeof forwardLog.$inferInsert;

export type TgSession = typeof tgSession.$inferSelect;
export type NewTgSession = typeof tgSession.$inferInsert;
