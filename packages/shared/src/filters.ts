/**
 * Filter rule type defs and zod schemas.
 *
 * The discriminator (`ruleType`) lives in the `subscription_filters.rule_type`
 * DB column, not inside the `params` JSON. Per-rule param schemas describe
 * only the params payload — no `type` field — and the schemas are keyed by
 * rule type via `filterRuleParamsSchemas` so callers can look up the right
 * validator from a row's `ruleType` column.
 */
import { z } from 'zod';

export const FILTER_RULE_TYPES = [
  'text-contains',
  'text-excludes',
  'text-regex',
  'has-media',
  'min-length',
  'sender-allowlist',
] as const;

export type FilterRuleType = (typeof FILTER_RULE_TYPES)[number];

// Per-filter mode (orthogonal to rule type). 'include' is the default and
// matches the historical AND-pass semantics: a message forwards only if
// every include filter matches. 'exclude' inverts the rule for that one
// row — the filter rejects the message when its rule does match.
export const FILTER_MODES = ['include', 'exclude'] as const;
export const filterModeSchema = z.enum(FILTER_MODES);
export type FilterMode = z.infer<typeof filterModeSchema>;

export const textContainsParamsSchema = z.object({
  value: z.string().min(1),
  caseInsensitive: z.boolean().default(true),
});
export type TextContainsParams = z.infer<typeof textContainsParamsSchema>;

export const textExcludesParamsSchema = z.object({
  value: z.string().min(1),
  caseInsensitive: z.boolean().default(true),
});
export type TextExcludesParams = z.infer<typeof textExcludesParamsSchema>;

// RE2 supports g/i/m/s/u/y but NOT v (no Unicode-set escapes). Reject any
// other character so a typo doesn't fail open at evaluation time.
const RE2_FLAGS_PATTERN = /^[gimsuy]*$/;

export const textRegexParamsSchema = z.object({
  pattern: z.string().min(1).max(500),
  flags: z
    .string()
    .default('')
    .refine((f) => RE2_FLAGS_PATTERN.test(f), 'invalid regex flags'),
});
export type TextRegexParams = z.infer<typeof textRegexParamsSchema>;

export const hasMediaParamsSchema = z.object({
  required: z.boolean().default(true),
});
export type HasMediaParams = z.infer<typeof hasMediaParamsSchema>;

export const minLengthParamsSchema = z.object({
  min: z.number().int().nonnegative(),
});
export type MinLengthParams = z.infer<typeof minLengthParamsSchema>;

export const senderAllowlistParamsSchema = z.object({
  usernames: z.array(z.string().min(1)).min(1),
});
export type SenderAllowlistParams = z.infer<typeof senderAllowlistParamsSchema>;

export const filterRuleParamsSchemas = {
  'text-contains': textContainsParamsSchema,
  'text-excludes': textExcludesParamsSchema,
  'text-regex': textRegexParamsSchema,
  'has-media': hasMediaParamsSchema,
  'min-length': minLengthParamsSchema,
  'sender-allowlist': senderAllowlistParamsSchema,
} as const satisfies Record<FilterRuleType, z.ZodTypeAny>;

export type FilterRuleParamsFor<T extends FilterRuleType> = z.infer<
  (typeof filterRuleParamsSchemas)[T]
>;

export type AnyFilterRuleParams = {
  [K in FilterRuleType]: FilterRuleParamsFor<K>;
}[FilterRuleType];
