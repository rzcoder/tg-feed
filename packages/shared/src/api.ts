// Wire-format source of truth: server validates with these schemas, web infers types.
// PATCH bodies are explicit (not `.partial()` of create — `.default()` fields make Input ≠ Output).
import { z } from 'zod';
import {
  FILTER_RULE_TYPES,
  filterModeSchema,
  filterRuleParamsSchemas,
  hasMediaParamsSchema,
  minLengthParamsSchema,
  senderAllowlistParamsSchema,
  textContainsParamsSchema,
  textExcludesParamsSchema,
  textRegexParamsSchema,
} from './filters.js';
import { FORWARD_LOG_STATUSES } from './forwardLog.js';

export { filterRuleParamsSchemas };

// --- Auth -------------------------------------------------------------

export const loginRequestSchema = z.object({
  // Cap length so a multi-MB string can't burn CPU through the SHA-256 compare.
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  authenticated: z.literal(true),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// Raw `WebApp.initData`; server verifies its HMAC vs bot token + admin allowlist.
// 8 KiB cap bounds HMAC work on this unauthenticated route (real payloads are ~hundreds of bytes).
export const telegramAuthRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});
export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>;

export const meResponseSchema = z.object({
  authenticated: z.literal(true),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- Access status (shared by destinations + subscription source) -----

// Whether the userbot can currently see/post to a chat; written by the access monitor's sweep.
export const accessStatusSchema = z.enum(['ok', 'no_access']);
export type AccessStatus = z.infer<typeof accessStatusSchema>;

// --- Destinations -----------------------------------------------------

// Numeric Telegram chat id; supergroups/channels start with -100.
export const telegramChatIdSchema = z
  .string()
  .min(1)
  .regex(/^-?\d{6,}$/, 'expected a numeric Telegram chat id');

// Forum topic `top_msg_id`; text for parity with the other Telegram ids.
export const forumTopicIdSchema = z
  .string()
  .min(1)
  .regex(/^\d{1,19}$/, 'expected a numeric forum topic id');

export const destinationDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  chatId: z.string(),
  note: z.string().nullable(),
  // topicId = topic's top_msg_id; null = General/no-topic. topicTitle cached at write time.
  topicId: z.string().nullable(),
  topicTitle: z.string().nullable(),
  // `data:image/jpeg;base64,...`; null until fetched (UI falls back to a lucide icon).
  iconDataUrl: z.string().nullable(),
  usageCount: z.number().int().nonnegative(),
  // 'ok' until the periodic sweep proves otherwise.
  accessStatus: accessStatusSchema,
  accessCheckedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DestinationDto = z.infer<typeof destinationDtoSchema>;

export const destinationListResponseSchema = z.object({
  items: z.array(destinationDtoSchema),
});
export type DestinationListResponse = z.infer<typeof destinationListResponseSchema>;

// Private invite hash from `t.me/+HASH` (opaque format; cap well above real-world ~16 chars).
export const telegramInviteHashSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'expected a Telegram invite hash');

// `inviteHash` path makes the server `ImportChatInvite` to join and derive the chatId.
export const createDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    chatId: telegramChatIdSchema.optional(),
    inviteHash: telegramInviteHashSchema.optional(),
    note: z.string().max(200).optional(),
    topicId: forumTopicIdSchema.nullable().optional(),
    topicTitle: z.string().max(200).nullable().optional(),
  })
  .refine((b) => (b.chatId ? 1 : 0) + (b.inviteHash ? 1 : 0) === 1, {
    message: 'exactly one of chatId or inviteHash is required',
  });
export type CreateDestinationRequest = z.infer<typeof createDestinationRequestSchema>;

// `POST /api/destinations/resolve` — preview only, no DB write.
export const resolveDestinationRequestSchema = z.object({
  input: z.string().min(1).max(200),
});
export type ResolveDestinationRequest = z.infer<typeof resolveDestinationRequestSchema>;

export const resolveDestinationResponseSchema = z.object({
  /** null only for not-yet-joined private invites — UI should fall back to inviteHash. */
  chatId: z.string().nullable(),
  title: z.string(),
  handle: z.string().nullable(),
  /** non-null for `t.me/+HASH` inputs; carries to the create endpoint. */
  inviteHash: z.string().nullable(),
  alreadyMember: z.boolean(),
  // False for not-yet-joined private invites — the chat is unknown until the userbot joins.
  isForum: z.boolean(),
});
export type ResolveDestinationResponse = z.infer<typeof resolveDestinationResponseSchema>;

export const updateDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    chatId: telegramChatIdSchema.optional(),
    note: z.string().max(200).nullable().optional(),
    topicId: forumTopicIdSchema.nullable().optional(),
    topicTitle: z.string().max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateDestinationRequest = z.infer<typeof updateDestinationRequestSchema>;

export const listForumTopicsRequestSchema = z.object({
  chatId: telegramChatIdSchema,
});
export type ListForumTopicsRequest = z.infer<typeof listForumTopicsRequestSchema>;

export const forumTopicSchema = z.object({
  id: z.string(), // top_msg_id
  title: z.string(),
});
export type ForumTopic = z.infer<typeof forumTopicSchema>;

export const listForumTopicsResponseSchema = z.object({
  isForum: z.boolean(),
  topics: z.array(forumTopicSchema),
});
export type ListForumTopicsResponse = z.infer<typeof listForumTopicsResponseSchema>;

// --- Subscriptions ----------------------------------------------------

export const subscriptionDtoSchema = z.object({
  id: z.number().int(),
  sourceChatId: z.string(),
  sourceTitle: z.string(),
  handle: z.string().nullable(),
  iconDataUrl: z.string().nullable(),
  // null = detached: subscription with no destination; forwarder skips it.
  destinationId: z.number().int().nullable(),
  destinationName: z.string().nullable(),
  destinationChatId: z.string().nullable(),
  enabled: z.boolean(),
  // own per-sub filters + attached library filters
  filterCount: z.number().int().nonnegative(),
  // forward_log rows with status='sent'
  forwardedCount: z.number().int().nonnegative(),
  libraryFilterIds: z.array(z.number().int().positive()),
  // last CHAT_FORWARDS_RESTRICTED rejection; cleared on the next successful forward.
  forwardingRestrictedAt: z.string().nullable(),
  sourceAccessStatus: accessStatusSchema,
  sourceAccessCheckedAt: z.string().nullable(),
  destinationAccessStatus: accessStatusSchema.nullable(),
  createdAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;

export const subscriptionListResponseSchema = z.object({
  items: z.array(subscriptionDtoSchema),
});
export type SubscriptionListResponse = z.infer<typeof subscriptionListResponseSchema>;

// Discriminated union forces `params` to match `ruleType`. `mode` optional; server defaults 'include'.
export const inlineFilterInputSchema = z.discriminatedUnion('ruleType', [
  z.object({
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
  z.object({
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
  z.object({
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
  z.object({
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
  z.object({
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
  z.object({
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  }),
]);
export type InlineFilterInput = z.infer<typeof inlineFilterInputSchema>;

// Generous caps that still bound the DB fan-out of a single create/patch/import request.
const SOURCE_CHAT_ID_MAX = 64;
const HANDLE_MAX = 64;
const SOURCE_TITLE_MAX = 255;
const PER_SUB_ARRAY_MAX = 200;

export const createSubscriptionRequestSchema = z
  .object({
    // `inviteHash` path makes the server `ImportChatInvite` to join and derive the chatId.
    sourceChatId: z.string().min(1).max(SOURCE_CHAT_ID_MAX).optional(),
    inviteHash: telegramInviteHashSchema.optional(),
    sourceTitle: z.string().min(1).max(SOURCE_TITLE_MAX),
    handle: z.string().min(1).max(HANDLE_MAX).optional(),
    // null/omitted = created detached: no forwarding until a destination is attached.
    destinationId: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    libraryFilterIds: z.array(z.number().int().positive()).max(PER_SUB_ARRAY_MAX).optional(),
    inlineFilters: z.array(inlineFilterInputSchema).max(PER_SUB_ARRAY_MAX).optional(),
  })
  .refine((b) => (b.sourceChatId ? 1 : 0) + (b.inviteHash ? 1 : 0) === 1, {
    message: 'exactly one of sourceChatId or inviteHash is required',
  });
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

// `sourceChatId`/`handle` intentionally immutable — delete and recreate to change the channel.
export const updateSubscriptionRequestSchema = z
  .object({
    sourceTitle: z.string().min(1).max(SOURCE_TITLE_MAX).optional(),
    // number = attach/replace; null = detach; omitted = leave alone.
    destinationId: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    // Bulk-replace; absent = leave alone, [] = detach all. Granular CRUD on the sub-routes.
    libraryFilterIds: z.array(z.number().int().positive()).max(PER_SUB_ARRAY_MAX).optional(),
    // Bulk-replace; absent = leave alone, [] = drop all. Granular CRUD on the sub-routes.
    inlineFilters: z.array(inlineFilterInputSchema).max(PER_SUB_ARRAY_MAX).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateSubscriptionRequest = z.infer<typeof updateSubscriptionRequestSchema>;

// `POST /api/subscriptions/resolve` — preview only, no DB write.
export const resolveSubscriptionRequestSchema = z.object({
  input: z.string().min(1).max(200),
});
export type ResolveSubscriptionRequest = z.infer<typeof resolveSubscriptionRequestSchema>;

export const resolveSubscriptionResponseSchema = z.object({
  /** null only for not-yet-joined private invites — UI should fall back to inviteHash. */
  sourceChatId: z.string().nullable(),
  sourceTitle: z.string(),
  handle: z.string().nullable(),
  /** non-null for `t.me/+HASH` inputs; carries to the create endpoint. */
  inviteHash: z.string().nullable(),
  alreadyMember: z.boolean(),
});
export type ResolveSubscriptionResponse = z.infer<typeof resolveSubscriptionResponseSchema>;

// --- Subscription filters ---------------------------------------------

export const subscriptionFilterDtoSchema = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int(),
  ruleType: z.enum(FILTER_RULE_TYPES),
  params: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  mode: filterModeSchema,
});
export type SubscriptionFilterDto = z.infer<typeof subscriptionFilterDtoSchema>;

export const subscriptionFilterListResponseSchema = z.object({
  items: z.array(subscriptionFilterDtoSchema),
});
export type SubscriptionFilterListResponse = z.infer<typeof subscriptionFilterListResponseSchema>;

export const createSubscriptionFilterRequestSchema = inlineFilterInputSchema;
export type CreateSubscriptionFilterRequest = z.infer<typeof createSubscriptionFilterRequestSchema>;

// `params` loose here (z.record); the route validates it against the row's ruleType. ruleType immutable.
export const updateSubscriptionFilterRequestSchema = z
  .object({
    params: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
    mode: filterModeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateSubscriptionFilterRequest = z.infer<typeof updateSubscriptionFilterRequestSchema>;

// --- Library filters --------------------------------------------------

export const libraryFilterDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  ruleType: z.enum(FILTER_RULE_TYPES),
  params: z.record(z.string(), z.unknown()),
  mode: filterModeSchema,
  // subscriptions this filter is attached to
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type LibraryFilterDto = z.infer<typeof libraryFilterDtoSchema>;

export const libraryFilterListResponseSchema = z.object({
  items: z.array(libraryFilterDtoSchema),
});
export type LibraryFilterListResponse = z.infer<typeof libraryFilterListResponseSchema>;

// Same shape as the subscription-filter union plus `name`. `mode` optional; route defaults 'include'.
export const createLibraryFilterRequestSchema = z.discriminatedUnion('ruleType', [
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
    mode: filterModeSchema.optional(),
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
    mode: filterModeSchema.optional(),
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
    mode: filterModeSchema.optional(),
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
    mode: filterModeSchema.optional(),
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
    mode: filterModeSchema.optional(),
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
    mode: filterModeSchema.optional(),
  }),
]);
export type CreateLibraryFilterRequest = z.infer<typeof createLibraryFilterRequestSchema>;

// `ruleType` immutable post-creation; the route validates `params` against the row's ruleType.
export const updateLibraryFilterRequestSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    mode: filterModeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateLibraryFilterRequest = z.infer<typeof updateLibraryFilterRequestSchema>;

// Idempotent: re-attaching is a no-op (PK violation suppressed).
export const attachLibraryFilterRequestSchema = z.object({
  libraryFilterId: z.number().int().positive(),
});
export type AttachLibraryFilterRequest = z.infer<typeof attachLibraryFilterRequestSchema>;

// --- Filter rule catalog ----------------------------------------------

export const filterRuleCatalogEntrySchema = z.object({
  type: z.enum(FILTER_RULE_TYPES),
  label: z.string(),
});
export type FilterRuleCatalogEntry = z.infer<typeof filterRuleCatalogEntrySchema>;

export const filterRuleCatalogResponseSchema = z.object({
  items: z.array(filterRuleCatalogEntrySchema),
});
export type FilterRuleCatalogResponse = z.infer<typeof filterRuleCatalogResponseSchema>;

// --- Settings ---------------------------------------------------------

export const statsDigestFrequencySchema = z.enum(['daily', 'weekly']);
export type StatsDigestFrequency = z.infer<typeof statsDigestFrequencySchema>;

// 24h clock, e.g. "09:00" / "23:30".
export const statsDigestTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24-hour)');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const statsDigestTimezoneSchema = z.string().min(1).refine(isValidTimeZone, {
  message: 'invalid IANA time zone',
});

// Per-field `.catch(default)` makes this double as the defensive reader for a hand-edited DB row.
export const statsDigestSettingsSchema = z.object({
  statsDigestEnabled: z.boolean().catch(false),
  statsDigestFrequency: statsDigestFrequencySchema.catch('daily'),
  // 0 = Sunday … 6 = Saturday; used only when frequency is 'weekly'.
  statsDigestDayOfWeek: z.number().int().min(0).max(6).catch(1),
  statsDigestTime: statsDigestTimeSchema.catch('09:00'),
  // Set from the operator's browser zone on save; 'UTC' is only the pre-first-save fallback.
  statsDigestTimezone: statsDigestTimezoneSchema.catch('UTC'),
});
export type StatsDigestSettings = z.infer<typeof statsDigestSettingsSchema>;

export const settingsDtoSchema = z
  .object({
    delayMs: z.number().int().positive(),
    // ms the album debouncer waits for more media-group members; raise on slow links to avoid fragmenting.
    albumDebounceMs: z.number().int().positive(),
  })
  .merge(statsDigestSettingsSchema);
export type SettingsDto = z.infer<typeof settingsDtoSchema>;

// Every field optional; the server merges into the existing row.
export const updateSettingsRequestSchema = z
  .object({
    delayMs: z.number().int().positive().optional(),
    albumDebounceMs: z.number().int().positive().optional(),
    statsDigestEnabled: z.boolean().optional(),
    statsDigestFrequency: statsDigestFrequencySchema.optional(),
    statsDigestDayOfWeek: z.number().int().min(0).max(6).optional(),
    statsDigestTime: statsDigestTimeSchema.optional(),
    statsDigestTimezone: statsDigestTimezoneSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// --- Forward log ------------------------------------------------------

export const forwardLogEntryDtoSchema = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int().nullable(),
  subscriptionTitle: z.string().nullable(),
  sourceHandle: z.string().nullable(),
  destinationName: z.string().nullable(),
  sourceMessageId: z.string(),
  destMessageId: z.string().nullable(),
  status: z.enum(FORWARD_LOG_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
  // Raw payload fetched on demand via `GET /forward-log/:id/raw`; kept off the list to keep it small.
  hasRawMessage: z.boolean(),
});
export type ForwardLogEntryDto = z.infer<typeof forwardLogEntryDtoSchema>;

export const forwardLogResponseSchema = z.object({
  items: z.array(forwardLogEntryDtoSchema),
  nextOffset: z.number().int().nullable(),
});
export type ForwardLogResponse = z.infer<typeof forwardLogResponseSchema>;

// rawMessage: single forward = object; album = array sorted ascending by source msg id; null if uncaptured.
export const forwardLogRawResponseSchema = z.object({
  rawMessage: z.unknown().nullable(),
});
export type ForwardLogRawResponse = z.infer<typeof forwardLogRawResponseSchema>;

export const FORWARD_LOG_LIMIT_DEFAULT = 50;
export const FORWARD_LOG_LIMIT_MAX = 200;

export const forwardLogQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(FORWARD_LOG_LIMIT_MAX)
    .default(FORWARD_LOG_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ForwardLogQuery = z.infer<typeof forwardLogQuerySchema>;

// --- System status ----------------------------------------------------

export const telegramStatusSchema = z.object({
  // `connecting` = boot window before `client.connect()` finishes (UI shows "starting up", not disconnected).
  state: z.enum(['connecting', 'connected', 'disconnected']),
  connected: z.boolean(), // redundant convenience for `state === 'connected'`
  reason: z.string().optional(),
});
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

export const systemStatusResponseSchema = z.object({
  telegram: telegramStatusSchema,
});
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

// --- Errors -----------------------------------------------------------

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
