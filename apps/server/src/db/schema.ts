// Telegram 64-bit chat/message IDs stored as text (lossless, opaque, never range-queried).
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

export const destinations = sqliteTable('destinations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  chatId: text('chat_id').notNull(),
  note: text('note'),
  // forum topic top_msg_id (text for 64-bit parity); NULL = General/none
  topicId: text('topic_id'),
  // cached topic title; NULL whenever topicId is NULL
  topicTitle: text('topic_title'),
  // data:image/jpeg;base64 URL; NULL until the access monitor's lazy backfill fetches it
  iconDataUrl: text('icon_data_url'),
  // written by the access monitor's sweep; default 'ok' so unswept rows aren't shown as broken
  accessStatus: text('access_status', { enum: ['ok', 'no_access'] })
    .notNull()
    .default('ok')
    .$type<'ok' | 'no_access'>(),
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
    // @channel_username; nullable for legacy rows
    handle: text('handle'),
    iconDataUrl: text('icon_data_url'),
    // nullable: subscription may be detached; ON DELETE SET NULL demotes rather than blocks
    destinationId: integer('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    // set on CHAT_FORWARDS_RESTRICTED (source has "Restrict Saving Content"), cleared on next success
    forwardingRestrictedAt: integer('forwarding_restricted_at', { mode: 'timestamp_ms' }),
    sourceAccessStatus: text('source_access_status', { enum: ['ok', 'no_access'] })
      .notNull()
      .default('ok')
      .$type<'ok' | 'no_access'>(),
    sourceAccessCheckedAt: integer('source_access_checked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    // every incoming TG message looks up by source_chat_id
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
    // 'include' = AND-pass; 'exclude' inverts (reject when the rule matches)
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

// Reusable named filter rules; rule type also guarded by a SQL CHECK against hand-written rows.
export const libraryFilters = sqliteTable(
  'library_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ruleType: text('rule_type').notNull().$type<FilterRuleType>(),
    params: text('params', { mode: 'json' }).$type<AnyFilterRuleParams>().notNull(),
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

// M:N join. No `enabled` column: detach == off, reattach == on.
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

// Singleton, always upserted at id=1 (normal PK so onConflictDoUpdate has no INSERT/UPDATE branch).
export const telegramAccount = sqliteTable('telegram_account', {
  id: integer('id').primaryKey(),
  // base64(iv ‖ tag ‖ ct) of StringSession.save(), encrypted with TG_SESSION_ENCRYPTION_KEY
  encryptedSessionString: text('encrypted_session_string').notNull(),
  // first 16 hex of sha256(key); matches an exported row against a host key without exposing it
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
    // raw gramjs Message snapshot; album batches store the same N-element array on every row
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

// Opaque per-login tokens (cookie value is the PK lookup); logout deletes the row to revoke.
// expiresAt is the hard cap; lastSeenAt drives the sliding-window refresh.
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
