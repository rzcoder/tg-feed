/**
 * HTTP API DTOs and request schemas.
 *
 * Single source of truth for the wire format between server and web.
 * Server validates requests with these zod schemas; web infers TS types
 * from them.
 *
 * Wire format conventions:
 *   - dates serialize as ISO 8601 strings; the server `.toISOString()`s
 *     before responding and the web does `new Date(iso)` if it needs a Date
 *   - list endpoints return `{ items: [...] }` envelopes for forwards-
 *     compatible pagination later
 *   - PATCH bodies are explicit (never `.partial()` of a create schema —
 *     `.default()` calls on field schemas would make Input ≠ Output and
 *     `.partial()` discards that distinction silently)
 */
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

// `filterRuleParamsSchemas` re-export keeps a single import surface for
// consumers that need both the catalog wire types and the per-rule params
// schemas (form generation in the web UI).
export { filterRuleParamsSchemas };

// --- Auth -------------------------------------------------------------

export const loginRequestSchema = z.object({
  // Cap the password length so a multi-MB string can't burn CPU through the
  // SHA-256 compare. Login is rate-limited but free CPU is still free CPU.
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  authenticated: z.literal(true),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  authenticated: z.literal(true),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- Access status (shared by destinations + subscription source) -----

// Whether the userbot can currently see/post to a chat. Written by the
// access monitor on the periodic sweep and on subscription create. The UI
// renders 'no_access' as a red "no access" badge.
export const accessStatusSchema = z.enum(['ok', 'no_access']);
export type AccessStatus = z.infer<typeof accessStatusSchema>;

// --- Destinations -----------------------------------------------------

// Numeric Telegram chat id; supergroups/channels start with -100. We allow
// any integer-shaped string (negative or positive) of at least 6 digits.
export const telegramChatIdSchema = z
  .string()
  .min(1)
  .regex(/^-?\d{6,}$/, 'expected a numeric Telegram chat id');

export const destinationDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  chatId: z.string(),
  note: z.string().nullable(),
  /**
   * Channel/chat profile photo as a `data:image/jpeg;base64,...` URL.
   * Null when not yet fetched (e.g. fresh migrations, Telegram-less boots,
   * channels with no photo). The web UI falls back to a lucide icon.
   */
  iconDataUrl: z.string().nullable(),
  usageCount: z.number().int().nonnegative(),
  /**
   * Whether the userbot can currently access this destination. 'ok' until
   * the periodic sweep proves otherwise. Drives the "no access" badge in
   * the web UI.
   */
  accessStatus: accessStatusSchema,
  /** ISO timestamp of the last access check; null until the first sweep. */
  accessCheckedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DestinationDto = z.infer<typeof destinationDtoSchema>;

export const destinationListResponseSchema = z.object({
  items: z.array(destinationDtoSchema),
});
export type DestinationListResponse = z.infer<typeof destinationListResponseSchema>;

// Telegram private invite hash extracted from `t.me/+HASH`. Same character
// set as a username plus `-`; length capped well above any real-world
// invite (typical hashes are ~16 chars, but the format is opaque).
export const telegramInviteHashSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'expected a Telegram invite hash');

// Either `chatId` (already-known numeric id; existing flow) or `inviteHash`
// (private invite — server will call `messages.ImportChatInvite` to join
// and derive the chatId). Exactly one is required; the refine guards both
// "neither provided" and "both provided".
export const createDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    chatId: telegramChatIdSchema.optional(),
    inviteHash: telegramInviteHashSchema.optional(),
    note: z.string().max(200).optional(),
  })
  .refine((b) => (b.chatId ? 1 : 0) + (b.inviteHash ? 1 : 0) === 1, {
    message: 'exactly one of chatId or inviteHash is required',
  });
export type CreateDestinationRequest = z.infer<typeof createDestinationRequestSchema>;

// `POST /api/destinations/resolve` — preview only, no DB write. Mirrors
// the subscription resolve endpoint. The UI debounces input changes and
// then submits the resolved fields to `POST /api/destinations` to commit.
export const resolveDestinationRequestSchema = z.object({
  input: z.string().min(1).max(200),
});
export type ResolveDestinationRequest = z.infer<typeof resolveDestinationRequestSchema>;

export const resolveDestinationResponseSchema = z.object({
  /** null only for not-yet-joined private invites — UI should fall back to inviteHash. */
  chatId: z.string().nullable(),
  title: z.string(),
  /** `@username` when known. */
  handle: z.string().nullable(),
  /** non-null for `t.me/+HASH` inputs; carries to the create endpoint. */
  inviteHash: z.string().nullable(),
  alreadyMember: z.boolean(),
});
export type ResolveDestinationResponse = z.infer<typeof resolveDestinationResponseSchema>;

export const updateDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    chatId: telegramChatIdSchema.optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateDestinationRequest = z.infer<typeof updateDestinationRequestSchema>;

// --- Subscriptions ----------------------------------------------------

export const subscriptionDtoSchema = z.object({
  id: z.number().int(),
  sourceChatId: z.string(),
  sourceTitle: z.string(),
  /** `@channel` handle, populated by the resolve endpoint at create time. */
  handle: z.string().nullable(),
  /**
   * Source channel profile photo as a `data:image/jpeg;base64,...` URL,
   * or null when not yet fetched. Same lifecycle as `destinationDtoSchema.iconDataUrl`.
   */
  iconDataUrl: z.string().nullable(),
  /**
   * FK to the destination chat. Nullable: a subscription can exist without
   * a destination (created via Settings → Import when the destination is
   * missing, or detached by the user). The forwarder skips such rows; the
   * UI shows a "no destination" badge.
   */
  destinationId: z.number().int().nullable(),
  /** Joined from `destinations` for UI rendering convenience; null when detached. */
  destinationName: z.string().nullable(),
  destinationChatId: z.string().nullable(),
  enabled: z.boolean(),
  /** Count of own per-sub filters + attached library filters. */
  filterCount: z.number().int().nonnegative(),
  /** Count of forward_log rows with status='sent' for this subscription. */
  forwardedCount: z.number().int().nonnegative(),
  /** Library filter ids attached to this subscription (sorted ascending). */
  libraryFilterIds: z.array(z.number().int().positive()),
  /**
   * ISO timestamp of the last `CHAT_FORWARDS_RESTRICTED` rejection from
   * the source channel; null otherwise. Drives the "noforwards" badge in
   * the web UI. Cleared by the server on the next successful forward.
   */
  forwardingRestrictedAt: z.string().nullable(),
  /**
   * Whether the userbot can currently read messages from the source
   * channel. Set on subscription create (after `channels.JoinChannel`) and
   * refreshed by the access monitor's periodic sweep. Drives the "no
   * access" badge.
   */
  sourceAccessStatus: accessStatusSchema,
  /** ISO timestamp of the last access check on the source. */
  sourceAccessCheckedAt: z.string().nullable(),
  /** Joined from `destinations.access_status`; null when detached. */
  destinationAccessStatus: accessStatusSchema.nullable(),
  createdAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;

export const subscriptionListResponseSchema = z.object({
  items: z.array(subscriptionDtoSchema),
});
export type SubscriptionListResponse = z.infer<typeof subscriptionListResponseSchema>;

// Shape of an inline-filter input shared by `createSubscriptionRequestSchema`
// (bulk inline-filters at sub-create time) and `createSubscriptionFilterRequestSchema`
// (granular inline-filter create at `POST /subscriptions/:id/filters`). The
// discriminated union forces `params` to match `ruleType` in one parse.
// `mode` is optional in the wire input; the server defaults to 'include'
// (matches the legacy AND-pass semantics for clients predating the column).
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

// Hard caps shared by create + patch + export-import. Pick generous values
// that still bound the fan-out of a single request into the DB:
//   - 64 chars for a chat id (Telegram ids are <20 chars; allow slack)
//   - 64 chars for `@handle`
//   - 255 chars for the human-supplied title (matches a typical DB varchar cap)
//   - 200 attachments / inline filters per subscription (UI would be unusable
//     past that; an import file with thousands of attachments is misuse)
const SOURCE_CHAT_ID_MAX = 64;
const HANDLE_MAX = 64;
const SOURCE_TITLE_MAX = 255;
const PER_SUB_ARRAY_MAX = 200;

export const createSubscriptionRequestSchema = z
  .object({
    /**
     * Either `sourceChatId` (resolved up-front via the resolve endpoint or
     * supplied directly as a numeric id) or `inviteHash` (private invite —
     * server calls `messages.ImportChatInvite` to join and derive the
     * resulting chatId). Exactly one is required.
     */
    sourceChatId: z.string().min(1).max(SOURCE_CHAT_ID_MAX).optional(),
    inviteHash: telegramInviteHashSchema.optional(),
    sourceTitle: z.string().min(1).max(SOURCE_TITLE_MAX),
    handle: z.string().min(1).max(HANDLE_MAX).optional(),
    /**
     * Optional. When omitted (or null), the subscription is created in a
     * detached state — no forwarding until the user attaches a destination.
     * Used by the import flow when the source's destination is missing.
     */
    destinationId: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    /**
     * Library filter ids to attach at create time. Bulk-replace semantics:
     * an empty array attaches none; absent field = same as empty.
     */
    libraryFilterIds: z.array(z.number().int().positive()).max(PER_SUB_ARRAY_MAX).optional(),
    /**
     * Private inline filters to materialize on the new subscription. Bulk
     * semantics: absent or `[]` means none. The discriminated union enforces
     * per-rule param validity.
     */
    inlineFilters: z.array(inlineFilterInputSchema).max(PER_SUB_ARRAY_MAX).optional(),
  })
  .refine((b) => (b.sourceChatId ? 1 : 0) + (b.inviteHash ? 1 : 0) === 1, {
    message: 'exactly one of sourceChatId or inviteHash is required',
  });
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

// `sourceChatId` and `handle` are intentionally immutable — to change the
// channel, delete and recreate. Other fields are mutable. `.refine` rejects
// an empty PATCH body so callers don't accidentally no-op.
export const updateSubscriptionRequestSchema = z
  .object({
    sourceTitle: z.string().min(1).max(SOURCE_TITLE_MAX).optional(),
    /**
     * Number to attach/replace; explicit `null` to detach. `undefined`
     * (omitted) leaves the existing value alone.
     */
    destinationId: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    /**
     * Bulk-replace the attached library filter set. Absent = leave alone;
     * empty array = detach all. Granular attach/detach also available at
     * `/api/subscriptions/:id/library-filters[/:libId]`.
     */
    libraryFilterIds: z.array(z.number().int().positive()).max(PER_SUB_ARRAY_MAX).optional(),
    /**
     * Bulk-replace the private inline filter set. Absent = leave alone;
     * empty array = drop all. Granular CRUD also available at
     * `/api/subscriptions/:id/filters[/:filterId]`.
     */
    inlineFilters: z.array(inlineFilterInputSchema).max(PER_SUB_ARRAY_MAX).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateSubscriptionRequest = z.infer<typeof updateSubscriptionRequestSchema>;

// `POST /api/subscriptions/resolve` — preview only, no DB write. The UI
// then submits the resolved fields to `POST /api/subscriptions`.
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

// `POST /subscriptions/:id/filters` body — same discriminated shape as
// `inlineFilterInputSchema`, exported under the route-specific name so
// existing imports keep working.
export const createSubscriptionFilterRequestSchema = inlineFilterInputSchema;
export type CreateSubscriptionFilterRequest = z.infer<typeof createSubscriptionFilterRequestSchema>;

// PATCH body — `params` is loose at this layer (`z.record`), and the route
// handler validates it against the matching `filterRuleParamsSchemas` for
// the existing row's `ruleType`. Keeping `ruleType` immutable post-create
// matches the create discriminator (changing rule type = different rule
// semantics; delete + re-add). `mode` is mutable — flipping include/exclude
// is exactly the kind of tweak callers do post-create.
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
  /** Number of subscriptions this library filter is attached to. */
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type LibraryFilterDto = z.infer<typeof libraryFilterDtoSchema>;

export const libraryFilterListResponseSchema = z.object({
  items: z.array(libraryFilterDtoSchema),
});
export type LibraryFilterListResponse = z.infer<typeof libraryFilterListResponseSchema>;

// Hand-listed discriminated union (mirrors `createSubscriptionFilterRequestSchema`)
// — z.discriminatedUnion needs a tuple of literal-typed variants. The
// extra `name` field is the only structural difference. `mode` is optional;
// the route defaults to 'include' when absent.
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

// `ruleType` is immutable post-creation — same precedent as
// `subscription_filters`: changing the rule type is delete + re-add. The
// route handler validates `params` against the existing row's `ruleType`.
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

// Attach an existing library filter to a subscription. Body just carries
// the library filter id; the URL captures the subscription. M:N row is
// idempotent — re-attaching is a no-op (PK violation suppressed).
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

export const settingsDtoSchema = z.object({
  delayMs: z.number().int().positive(),
  /**
   * Window (ms) the album debouncer waits for additional members of a
   * Telegram media group before forwarding. Increase on slow links where
   * album members arrive >2 s apart and end up fragmented; lower if you
   * want forwards to happen sooner.
   */
  albumDebounceMs: z.number().int().positive(),
});
export type SettingsDto = z.infer<typeof settingsDtoSchema>;

// Both fields optional so the client can update one without overwriting the
// other — the server merges into the existing row.
export const updateSettingsRequestSchema = z
  .object({
    delayMs: z.number().int().positive().optional(),
    albumDebounceMs: z.number().int().positive().optional(),
  })
  .refine((d) => d.delayMs !== undefined || d.albumDebounceMs !== undefined, {
    message: 'at least one of delayMs / albumDebounceMs must be provided',
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
  /**
   * Whether the row has a stored JSON snapshot of the raw Telegram message.
   * Fetch the actual payload via `GET /forward-log/:id/raw` on demand —
   * the raw JSON is intentionally kept off the list endpoint to keep page
   * responses small.
   */
  hasRawMessage: z.boolean(),
});
export type ForwardLogEntryDto = z.infer<typeof forwardLogEntryDtoSchema>;

export const forwardLogResponseSchema = z.object({
  items: z.array(forwardLogEntryDtoSchema),
  nextOffset: z.number().int().nullable(),
});
export type ForwardLogResponse = z.infer<typeof forwardLogResponseSchema>;

/**
 * Response for `GET /forward-log/:id/raw`. `rawMessage` is the JSON snapshot
 * stored at forward time — a plain object for single-message forwards, an
 * array of objects (sorted ascending by source message id) for album
 * batches. `null` for rows that pre-date the feature or for events that
 * deliberately skipped capture (e.g. `MessageEmpty`).
 */
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
  /**
   * Lifecycle phase. `connecting` covers the boot window before the gramjs
   * client has finished `client.connect()` (and the listener / monitors are
   * attached). The web UI uses this to show a neutral "starting up" state
   * instead of the disconnected alert during normal dev reloads.
   * `connected: boolean` is kept as a redundant convenience equal to
   * `state === 'connected'` so existing call sites don't need to be updated.
   */
  state: z.enum(['connecting', 'connected', 'disconnected']),
  connected: z.boolean(),
  /** Human-readable reason; present when state is 'connecting' or 'disconnected'. */
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
