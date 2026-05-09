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

// --- Subscriptions ----------------------------------------------------

export const subscriptionDtoSchema = z.object({
  id: z.number().int(),
  sourceChatId: z.string(),
  sourceTitle: z.string(),
  destinationChatId: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;

export const subscriptionListResponseSchema = z.object({
  items: z.array(subscriptionDtoSchema),
});
export type SubscriptionListResponse = z.infer<typeof subscriptionListResponseSchema>;

export const createSubscriptionRequestSchema = z.object({
  sourceChatId: z.string().min(1),
  sourceTitle: z.string().min(1),
  destinationChatId: z.string().min(1),
  enabled: z.boolean().optional(),
});
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

// `sourceChatId` is intentionally immutable — to change it, delete and
// recreate. The remaining fields are mutable. The `.refine` rejects an
// empty PATCH body so callers don't accidentally no-op.
export const updateSubscriptionRequestSchema = z
  .object({
    sourceTitle: z.string().min(1).optional(),
    destinationChatId: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateSubscriptionRequest = z.infer<typeof updateSubscriptionRequestSchema>;

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

// Discriminated union over `ruleType` so the server validates `params`
// against the matching rule's schema in one parse call. Variants are
// hand-listed (rather than mapped from `FILTER_RULE_TYPES`) so TS infers
// each variant's literal discriminator and `z.discriminatedUnion`'s
// tuple-shape requirement is satisfied.
export const createSubscriptionFilterRequestSchema = z.discriminatedUnion('ruleType', [
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

// --- Errors -----------------------------------------------------------

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
