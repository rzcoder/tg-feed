/**
 * Settings → Data export/import wire format.
 *
 * The export envelope is a versioned JSON document so a future schema bump
 * can keep parsing older files. v1 is the initial format.
 *
 * IDs are intentionally NOT exported — the import remaps via natural keys
 * (`destination = (chatId, name)`, `libraryFilter = name`,
 * `subscription = sourceChatId`) so a file produced on instance A can be
 * applied to instance B without primary-key collisions.
 */
import { z } from 'zod';
import {
  filterModeSchema,
  hasMediaParamsSchema,
  minLengthParamsSchema,
  senderAllowlistParamsSchema,
  textContainsParamsSchema,
  textExcludesParamsSchema,
  textRegexParamsSchema,
} from './filters.js';

// v2 (2026-05): extended `appSettings` with an optional `telegramAccount`
// sub-object carrying the encrypted session string + key fingerprint. v1
// files (no `telegramAccount` field) round-trip unchanged through v2
// importers; v2 files are rejected by v1 importers via the existing
// `schemaVersion > EXPORT_SCHEMA_VERSION` guard.
export const EXPORT_SCHEMA_VERSION = 2;

// --- Section: destinations -------------------------------------------------

export const exportedDestinationSchema = z.object({
  name: z.string().min(1),
  chatId: z.string().min(1),
  note: z.string().nullable().optional(),
});
export type ExportedDestination = z.infer<typeof exportedDestinationSchema>;

// --- Section: library filters ---------------------------------------------

// Library filter shape — same per-rule discriminated union as the create
// endpoint, with `name` carried at the top level (export-level, not inside
// the rule discriminator).
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
]);
export type ExportedLibraryFilter = z.infer<typeof exportedLibraryFilterSchema>;

// --- Section: subscriptions -----------------------------------------------

// Inline filter shape inside an exported subscription. Slightly broader than
// the wire `inlineFilterInputSchema` — `enabled` and `mode` are required so
// round-trip preserves them losslessly.
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
]);
export type ExportedInlineFilter = z.infer<typeof exportedInlineFilterSchema>;

export const exportedSubscriptionSchema = z.object({
  sourceChatId: z.string().min(1),
  sourceTitle: z.string().min(1),
  handle: z.string().nullable(),
  enabled: z.boolean(),
  /**
   * Embedded by-natural-key reference to the destination. Null means the
   * subscription was exported in a detached state (no destination attached).
   * On import: matched against existing destinations by `(chatId, name)`,
   * and against the current export envelope's `destinations` section.
   */
  destination: z
    .object({
      chatId: z.string().min(1),
      name: z.string().min(1),
    })
    .nullable(),
  inlineFilters: z.array(exportedInlineFilterSchema),
  /** Library filter references by name. Resolved at import time. */
  libraryFilters: z.array(z.object({ name: z.string().min(1) })),
});
export type ExportedSubscription = z.infer<typeof exportedSubscriptionSchema>;

// --- Section: app settings ------------------------------------------------

/**
 * Encrypted Telegram session as embedded in the appSettings export section.
 * The host that mints this row encrypts the session with its
 * `TG_SESSION_ENCRYPTION_KEY` and stamps the first 16 hex chars of
 * `sha256(key)` as `keyFingerprint`. An importer with a different key
 * detects the mismatch via the fingerprint and skips the row with a
 * `telegram_account_key_mismatch` warning. Without a key configured the
 * importer skips with `telegram_account_no_key`.
 */
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
  /**
   * Optional v2 addition. Older (v1) files don't carry it and just import
   * the throttle/debouncer fields. v2 importers without a configured
   * `TG_SESSION_ENCRYPTION_KEY`, or with a key whose fingerprint doesn't
   * match this row's, emit a warning and skip just the account write.
   */
  telegramAccount: exportedTelegramAccountSchema.optional(),
});
export type ExportedAppSettings = z.infer<typeof exportedAppSettingsSchema>;

// --- Top-level envelope ---------------------------------------------------

export const EXPORT_SECTIONS = [
  'destinations',
  'libraryFilters',
  'subscriptions',
  'appSettings',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];
export const exportSectionSchema = z.enum(EXPORT_SECTIONS);

// Sections are optional — absent means "not exported". This lets the import
// flow distinguish "user didn't export this" from "user exported nothing".
export const exportFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  appVersion: z.string(),
  destinations: z.array(exportedDestinationSchema).optional(),
  libraryFilters: z.array(exportedLibraryFilterSchema).optional(),
  subscriptions: z.array(exportedSubscriptionSchema).optional(),
  appSettings: exportedAppSettingsSchema.optional(),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

// --- API: POST /system/export ---------------------------------------------

export const exportRequestSchema = z.object({
  sections: z.array(exportSectionSchema).min(1),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

// --- API: POST /system/import ---------------------------------------------

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
  /**
   * Coarse category. Frontend can group/colour these; UI doesn't need to
   * branch per kind beyond presentation. Add new kinds as needed —
   * unrecognised kinds render with the default style.
   */
  kind: z.enum([
    'destination_missing',
    'library_filter_missing',
    'inline_filter_invalid',
    'rule_type_mismatch',
    'subscription_skipped',
    /** v2: importer has no `TG_SESSION_ENCRYPTION_KEY`, account row skipped. */
    'telegram_account_no_key',
    /** v2: account row encrypted with a different key, skipped. */
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

// --- API: POST /system/wipe -----------------------------------------------

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
