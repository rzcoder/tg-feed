// The `ruleType` discriminator lives in the DB column, not in `params`; per-rule schemas cover only params.
import { z } from 'zod';

export const FILTER_RULE_TYPES = [
  'text-contains',
  'text-excludes',
  'text-regex',
  'has-media',
  'min-length',
  'sender-allowlist',
  'link-prefix',
] as const;

export type FilterRuleType = (typeof FILTER_RULE_TYPES)[number];

// 'include' = AND-pass (forward only if every include matches); 'exclude' rejects when the rule matches.
export const FILTER_MODES = ['include', 'exclude'] as const;
export const filterModeSchema = z.enum(FILTER_MODES);
export type FilterMode = z.infer<typeof filterModeSchema>;

// includeEntities also searches entity-carried text absent from the visible body: hidden hyperlink targets (TextUrl) and code-block language tags (Pre).
export const textContainsParamsSchema = z.object({
  value: z.string().min(1).max(500),
  caseInsensitive: z.boolean().default(true),
  includeEntities: z.boolean().default(false),
});
export type TextContainsParams = z.infer<typeof textContainsParamsSchema>;

export const textExcludesParamsSchema = z.object({
  value: z.string().min(1).max(500),
  caseInsensitive: z.boolean().default(true),
  includeEntities: z.boolean().default(false),
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
  includeEntities: z.boolean().default(false),
});
export type TextRegexParams = z.infer<typeof textRegexParamsSchema>;

// 'gt'/'lt' compare the message's media count (1 for a single media message, N for an album) against `count`.
export const HAS_MEDIA_COUNT_OPS = ['gt', 'lt'] as const;
export const hasMediaCountOpSchema = z.enum(HAS_MEDIA_COUNT_OPS);
export type HasMediaCountOp = z.infer<typeof hasMediaCountOpSchema>;

export const hasMediaParamsSchema = z
  .object({
    required: z.boolean().default(true),
    // Optional media-count comparison; countOp and count are set together, and only alongside required (has media).
    countOp: hasMediaCountOpSchema.optional(),
    count: z.number().int().min(1).max(100).optional(),
  })
  .refine((p) => (p.countOp === undefined) === (p.count === undefined), {
    message: 'countOp and count must be set together',
  })
  .refine((p) => p.required !== false || p.countOp === undefined, {
    message: 'media count comparison requires has-media',
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

// Where to look for links: 'text' = URLs in the visible body, 'entity' = hidden hyperlink targets, 'both' = either.
export const LINK_PREFIX_SCOPES = ['text', 'entity', 'both'] as const;
export const linkPrefixScopeSchema = z.enum(LINK_PREFIX_SCOPES);
export type LinkPrefixScope = z.infer<typeof linkPrefixScopeSchema>;

// Prefix-matches a message's links. A scheme in `value` (e.g. https://) is matched verbatim; without one, any protocol matches.
export const linkPrefixParamsSchema = z.object({
  value: z.string().min(1).max(500),
  scope: linkPrefixScopeSchema.default('both'),
});
export type LinkPrefixParams = z.infer<typeof linkPrefixParamsSchema>;

export const filterRuleParamsSchemas = {
  'text-contains': textContainsParamsSchema,
  'text-excludes': textExcludesParamsSchema,
  'text-regex': textRegexParamsSchema,
  'has-media': hasMediaParamsSchema,
  'min-length': minLengthParamsSchema,
  'sender-allowlist': senderAllowlistParamsSchema,
  'link-prefix': linkPrefixParamsSchema,
} as const satisfies Record<FilterRuleType, z.ZodTypeAny>;

// UI seed params for a new rule of each type; every default must parse against its schema.
export const filterRuleDefaultParams: Record<FilterRuleType, Record<string, unknown>> = {
  'text-contains': { value: '', caseInsensitive: true, includeEntities: false },
  'text-excludes': { value: '', caseInsensitive: true, includeEntities: false },
  'text-regex': { pattern: '', flags: 'i', includeEntities: false },
  'has-media': { required: true },
  'min-length': { min: 50 },
  'sender-allowlist': { usernames: [] },
  'link-prefix': { value: '', scope: 'both' },
};

export type FilterRuleParamsFor<T extends FilterRuleType> = z.infer<
  (typeof filterRuleParamsSchemas)[T]
>;

export type AnyFilterRuleParams = {
  [K in FilterRuleType]: FilterRuleParamsFor<K>;
}[FilterRuleType];
