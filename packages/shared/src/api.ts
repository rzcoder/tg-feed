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
  password: z.string().min(1),
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
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type DestinationDto = z.infer<typeof destinationDtoSchema>;

export const destinationListResponseSchema = z.object({
  items: z.array(destinationDtoSchema),
});
export type DestinationListResponse = z.infer<typeof destinationListResponseSchema>;

export const createDestinationRequestSchema = z.object({
  name: z.string().min(1).max(80),
  chatId: telegramChatIdSchema,
  note: z.string().max(200).optional(),
});
export type CreateDestinationRequest = z.infer<typeof createDestinationRequestSchema>;

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
  destinationId: z.number().int(),
  /** Joined from `destinations` for UI rendering convenience. */
  destinationName: z.string(),
  destinationChatId: z.string(),
  enabled: z.boolean(),
  /** Count of own per-sub filters + attached library filters. */
  filterCount: z.number().int().nonnegative(),
  /** Count of forward_log rows with status='sent' for this subscription. */
  forwardedCount: z.number().int().nonnegative(),
  /** Library filter ids attached to this subscription (sorted ascending). */
  libraryFilterIds: z.array(z.number().int().positive()),
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
export const inlineFilterInputSchema = z.discriminatedUnion('ruleType', [
  z.object({
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
    enabled: z.boolean().optional(),
  }),
]);
export type InlineFilterInput = z.infer<typeof inlineFilterInputSchema>;

export const createSubscriptionRequestSchema = z.object({
  sourceChatId: z.string().min(1),
  sourceTitle: z.string().min(1),
  handle: z.string().min(1).optional(),
  destinationId: z.number().int().positive(),
  enabled: z.boolean().optional(),
  /**
   * Library filter ids to attach at create time. Bulk-replace semantics:
   * an empty array attaches none; absent field = same as empty.
   */
  libraryFilterIds: z.array(z.number().int().positive()).optional(),
  /**
   * Private inline filters to materialize on the new subscription. Bulk
   * semantics: absent or `[]` means none. The discriminated union enforces
   * per-rule param validity.
   */
  inlineFilters: z.array(inlineFilterInputSchema).optional(),
});
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

// `sourceChatId` and `handle` are intentionally immutable — to change the
// channel, delete and recreate. Other fields are mutable. `.refine` rejects
// an empty PATCH body so callers don't accidentally no-op.
export const updateSubscriptionRequestSchema = z
  .object({
    sourceTitle: z.string().min(1).optional(),
    destinationId: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    /**
     * Bulk-replace the attached library filter set. Absent = leave alone;
     * empty array = detach all. Granular attach/detach also available at
     * `/api/subscriptions/:id/library-filters[/:libId]`.
     */
    libraryFilterIds: z.array(z.number().int().positive()).optional(),
    /**
     * Bulk-replace the private inline filter set. Absent = leave alone;
     * empty array = drop all. Granular CRUD also available at
     * `/api/subscriptions/:id/filters[/:filterId]`.
     */
    inlineFilters: z.array(inlineFilterInputSchema).optional(),
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
  sourceChatId: z.string(),
  sourceTitle: z.string(),
  handle: z.string().nullable(),
});
export type ResolveSubscriptionResponse = z.infer<typeof resolveSubscriptionResponseSchema>;

// --- Subscription filters ---------------------------------------------

export const subscriptionFilterDtoSchema = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int(),
  ruleType: z.enum(FILTER_RULE_TYPES),
  params: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
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
// semantics; delete + re-add).
export const updateSubscriptionFilterRequestSchema = z
  .object({
    params: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
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
// extra `name` field is the only structural difference.
export const createLibraryFilterRequestSchema = z.discriminatedUnion('ruleType', [
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
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
});
export type SettingsDto = z.infer<typeof settingsDtoSchema>;

export const updateSettingsRequestSchema = z.object({
  delayMs: z.number().int().positive(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// --- Forward log ------------------------------------------------------

export const forwardLogEntryDtoSchema = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int().nullable(),
  subscriptionTitle: z.string().nullable(),
  sourceMessageId: z.string(),
  destMessageId: z.string().nullable(),
  status: z.enum(FORWARD_LOG_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ForwardLogEntryDto = z.infer<typeof forwardLogEntryDtoSchema>;

export const forwardLogResponseSchema = z.object({
  items: z.array(forwardLogEntryDtoSchema),
  nextOffset: z.number().int().nullable(),
});
export type ForwardLogResponse = z.infer<typeof forwardLogResponseSchema>;

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
  connected: z.boolean(),
  /** Human-readable reason; only present when not connected. */
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
