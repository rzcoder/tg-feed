// The `ruleType` discriminator lives in the DB column, not in `params`; per-rule schemas cover only params.
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

// 'include' = AND-pass (forward only if every include matches); 'exclude' rejects when the rule matches.
export const FILTER_MODES = ['include', 'exclude'] as const;
export const filterModeSchema = z.enum(FILTER_MODES);
export type FilterMode = z.infer<typeof filterModeSchema>;

export const textContainsParamsSchema = z.object({
  value: z.string().min(1).max(500),
  caseInsensitive: z.boolean().default(true),
});
export type TextContainsParams = z.infer<typeof textContainsParamsSchema>;

export const textExcludesParamsSchema = z.object({
  value: z.string().min(1).max(500),
  caseInsensitive: z.boolean().default(true),
});
export type TextExcludesParams = z.infer<typeof textExcludesParamsSchema>;

// RE2 allows g/i/m/s/u/y but NOT v; reject others so a typo doesn't fail open at eval time.
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

// Cap the array: the evaluator walks every entry on every matching message.
export const senderAllowlistParamsSchema = z.object({
  usernames: z.array(z.string().min(1).max(64)).min(1).max(100),
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

// UI seed params for a new rule of each type; every default must parse against its schema.
export const filterRuleDefaultParams: Record<FilterRuleType, Record<string, unknown>> = {
  'text-contains': { value: '', caseInsensitive: true },
  'text-excludes': { value: '', caseInsensitive: true },
  'text-regex': { pattern: '', flags: 'i' },
  'has-media': { required: true },
  'min-length': { min: 50 },
  'sender-allowlist': { usernames: [] },
};

export type FilterRuleParamsFor<T extends FilterRuleType> = z.infer<
  (typeof filterRuleParamsSchemas)[T]
>;

export type AnyFilterRuleParams = {
  [K in FilterRuleType]: FilterRuleParamsFor<K>;
}[FilterRuleType];
