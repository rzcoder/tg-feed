// Versioned export/import wire format. IDs are NOT exported; import remaps via natural keys
// (destination=(chatId,name), libraryFilter=name, subscription=sourceChatId) to avoid PK collisions across instances.
import { z } from 'zod';
import {
  statsDigestFrequencySchema,
  statsDigestTimeSchema,
  statsDigestTimezoneSchema,
} from './api.js';
import {
  filterModeSchema,
  hasMediaParamsSchema,
  linkPrefixParamsSchema,
  minLengthParamsSchema,
  senderAllowlistParamsSchema,
  textContainsParamsSchema,
  textExcludesParamsSchema,
  textRegexParamsSchema,
} from './filters.js';

export const EXPORT_SCHEMA_VERSION = 2;

export const exportedDestinationSchema = z.object({
  name: z.string().min(1).max(80),
  chatId: z.string().min(1).max(64),
  note: z.string().max(200).nullable().optional(),
  // forum topic; null/omitted = General / non-forum
  topicId: z.string().min(1).max(19).nullable().optional(),
  topicTitle: z.string().max(200).nullable().optional(),
});
export type ExportedDestination = z.infer<typeof exportedDestinationSchema>;

export const exportedLibraryFilterSchema = z.discriminatedUnion('ruleType', [
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
    mode: filterModeSchema,
  }),
  z.object({
    name: z.string().min(1).max(80),
    ruleType: z.literal('link-prefix'),
    params: linkPrefixParamsSchema,
    mode: filterModeSchema,
  }),
]);
export type ExportedLibraryFilter = z.infer<typeof exportedLibraryFilterSchema>;

// Broader than inlineFilterInputSchema: enabled/mode required for lossless round-trip.
export const exportedInlineFilterSchema = z.discriminatedUnion('ruleType', [
  z.object({
    ruleType: z.literal('text-contains'),
    params: textContainsParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('text-excludes'),
    params: textExcludesParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('text-regex'),
    params: textRegexParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('has-media'),
    params: hasMediaParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('min-length'),
    params: minLengthParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('sender-allowlist'),
    params: senderAllowlistParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
  z.object({
    ruleType: z.literal('link-prefix'),
    params: linkPrefixParamsSchema,
    enabled: z.boolean(),
    mode: filterModeSchema,
  }),
]);
export type ExportedInlineFilter = z.infer<typeof exportedInlineFilterSchema>;

export const exportedSubscriptionSchema = z.object({
  sourceChatId: z.string().min(1).max(64),
  sourceTitle: z.string().min(1).max(255),
  handle: z.string().max(64).nullable(),
  enabled: z.boolean(),
  // by-natural-key (chatId,name) ref; null = detached export
  destination: z
    .object({
      chatId: z.string().min(1).max(64),
      name: z.string().min(1).max(80),
    })
    .nullable(),
  inlineFilters: z.array(exportedInlineFilterSchema).max(200),
  libraryFilters: z.array(z.object({ name: z.string().min(1).max(80) })).max(200),
});
export type ExportedSubscription = z.infer<typeof exportedSubscriptionSchema>;

// keyFingerprint = first 16 hex of sha256(TG_SESSION_ENCRYPTION_KEY); importer skips the row on mismatch/no-key.
export const exportedTelegramAccountSchema = z.object({
  encryptedSessionString: z.string().min(1),
  keyFingerprint: z.string().min(1),
  phoneNumber: z.string().nullable(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  telegramUserId: z.string().nullable(),
});
export type ExportedTelegramAccount = z.infer<typeof exportedTelegramAccountSchema>;

export const exportedAppSettingsSchema = z.object({
  delayMs: z.number().int().positive(),
  albumDebounceMs: z.number().int().positive(),
  telegramAccount: exportedTelegramAccountSchema.optional(),
  // stats-digest schedule; importer merges only present fields onto the global row
  statsDigestEnabled: z.boolean().optional(),
  statsDigestFrequency: statsDigestFrequencySchema.optional(),
  statsDigestDayOfWeek: z.number().int().min(0).max(6).optional(),
  statsDigestTime: statsDigestTimeSchema.optional(),
  statsDigestTimezone: statsDigestTimezoneSchema.optional(),
});
export type ExportedAppSettings = z.infer<typeof exportedAppSettingsSchema>;

export const EXPORT_SECTIONS = [
  'destinations',
  'libraryFilters',
  'subscriptions',
  'appSettings',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];
export const exportSectionSchema = z.enum(EXPORT_SECTIONS);

// Caps parser allocation ahead of the route's 2 MB body limit.
const EXPORT_ARRAY_MAX = 2000;

// Absent section = "not exported", distinct from an exported-but-empty one.
export const exportFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  appVersion: z.string(),
  destinations: z.array(exportedDestinationSchema).max(EXPORT_ARRAY_MAX).optional(),
  libraryFilters: z.array(exportedLibraryFilterSchema).max(EXPORT_ARRAY_MAX).optional(),
  subscriptions: z.array(exportedSubscriptionSchema).max(EXPORT_ARRAY_MAX).optional(),
  appSettings: exportedAppSettingsSchema.optional(),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

export const exportRequestSchema = z.object({
  sections: z.array(exportSectionSchema).min(1),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const importConflictStrategySchema = z.enum(['skip', 'replace']);
export type ImportConflictStrategy = z.infer<typeof importConflictStrategySchema>;

export const importRequestSchema = z.object({
  sections: z.array(exportSectionSchema).min(1),
  conflictStrategy: importConflictStrategySchema,
  data: exportFileSchema,
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const importSectionResultSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  replaced: z.number().int().nonnegative(),
});
export type ImportSectionResult = z.infer<typeof importSectionResultSchema>;

export const importWarningSchema = z.object({
  kind: z.enum([
    'destination_missing',
    'library_filter_missing',
    'inline_filter_invalid',
    'rule_type_mismatch',
    'subscription_skipped',
    'telegram_account_no_key',
    'telegram_account_key_mismatch',
  ]),
  message: z.string(),
});
export type ImportWarning = z.infer<typeof importWarningSchema>;

export const importResultSchema = z.object({
  destinations: importSectionResultSchema,
  libraryFilters: importSectionResultSchema,
  subscriptions: importSectionResultSchema,
  appSettings: importSectionResultSchema,
  warnings: z.array(importWarningSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const WIPE_SECTIONS = ['destinations', 'libraryFilters', 'subscriptions'] as const;
export type WipeSection = (typeof WIPE_SECTIONS)[number];
export const wipeSectionSchema = z.enum(WIPE_SECTIONS);

export const wipeRequestSchema = z.object({
  sections: z.array(wipeSectionSchema).min(1),
});
export type WipeRequest = z.infer<typeof wipeRequestSchema>;

export const wipeResultSchema = z.object({
  deleted: z.object({
    destinations: z.number().int().nonnegative(),
    libraryFilters: z.number().int().nonnegative(),
    subscriptions: z.number().int().nonnegative(),
  }),
});
export type WipeResult = z.infer<typeof wipeResultSchema>;
