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

export const textRegexParamsSchema = z.object({
  pattern: z.string().min(1),
  flags: z.string().default(''),
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
