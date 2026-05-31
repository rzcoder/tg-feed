/**
 * Wire-format schemas for the DB-backed bot configuration exposed by
 * `apps/server/src/api/routes/botConfig.ts` and consumed by the Settings
 * page's Bot section.
 *
 * The GET payload is *masked* — it never returns the bot token, only whether
 * one is configured and from where (`db` | `env`). The bot token, admin
 * allowlist and public URL each resolve DB-first with an env fallback, so each
 * carries its own `*Source` field.
 */
import { z } from 'zod';

/** Source of a resolved field: the DB row wins over env. */
export const botConfigSourceSchema = z.enum(['db', 'env']);
export type BotConfigSource = z.infer<typeof botConfigSourceSchema>;

// BotFather tokens are `<bot_id>:<auth_token>` — digits, a colon, then ~35
// chars of base64url-ish auth. Validate loosely so a future format tweak
// doesn't reject a working token, but tightly enough to reject pasted junk.
export const botTokenSchema = z
  .string()
  .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'expected a BotFather token like 12345:ABC...');

// Telegram user ids are 64-bit; keep them as strings so large ids stay
// lossless (the env parser does the same). Numeric-only, deduped server-side.
export const botAdminIdSchema = z.string().regex(/^\d+$/, 'expected a numeric Telegram user id');

/**
 * An admin allowlist entry. `id` is what actually gates the bot; the display
 * fields are looked up from `@username` (like a channel's title) so the UI
 * can render a name instead of a bare id. They're `null` for admins that come
 * from the env var (raw ids, no lookup) or were added by id directly.
 */
export const botAdminSchema = z.object({
  id: botAdminIdSchema,
  displayName: z.string().nullable(),
  username: z.string().nullable(),
});
export type BotAdmin = z.infer<typeof botAdminSchema>;

export const botConfigInfoSchema = z.object({
  /** True when the resolver picked up a token (DB or env). */
  tokenConfigured: z.boolean(),
  tokenSource: botConfigSourceSchema.nullable(),
  /** Whether `TG_SESSION_ENCRYPTION_KEY` is configured (gates token writes). */
  encryptionKeyConfigured: z.boolean(),
  /**
   * True when a token is stored in the DB but encrypted with a different
   * `TG_SESSION_ENCRYPTION_KEY` than the one currently configured. The
   * resolver falls through to env; the UI surfaces a "key mismatch" hint.
   */
  keyFingerprintMismatch: z.boolean(),
  admins: z.array(botAdminSchema),
  adminsSource: botConfigSourceSchema.nullable(),
  publicUrl: z.string().nullable(),
  publicUrlSource: botConfigSourceSchema.nullable(),
  /** Whether the long-polling bot is currently running. */
  botRunning: z.boolean(),
});
export type BotConfigInfo = z.infer<typeof botConfigInfoSchema>;

/**
 * Partial update. Per field: omitted = leave unchanged, `null` = clear the
 * DB value (fall back to env), a value = set it. At least one field must be
 * present. `admins` carries the full desired list (the UI adds/removes
 * entries client-side, then saves the whole set).
 */
export const updateBotConfigRequestSchema = z
  .object({
    token: botTokenSchema.nullable().optional(),
    admins: z.array(botAdminSchema).max(50).nullable().optional(),
    publicUrl: z.string().url().nullable().optional(),
  })
  .refine((d) => d.token !== undefined || d.admins !== undefined || d.publicUrl !== undefined, {
    message: 'at least one of token / admins / publicUrl must be provided',
  });
export type UpdateBotConfigRequest = z.infer<typeof updateBotConfigRequestSchema>;

// --- Admin lookup (resolve @username → user) ------------------------------

/**
 * `POST /api/config/bot/resolve-admin` — preview only, no write. Resolves a
 * `@username` / `t.me/username` / numeric user id to a Telegram *user* (the
 * same resolver that backs channel lookup, but rejecting channels/groups).
 * The UI debounces input and then submits the resolved entry into `admins`.
 */
export const resolveBotAdminRequestSchema = z.object({
  query: z.string().min(1).max(128),
});
export type ResolveBotAdminRequest = z.infer<typeof resolveBotAdminRequestSchema>;

export const resolveBotAdminResponseSchema = botAdminSchema;
export type ResolveBotAdminResponse = z.infer<typeof resolveBotAdminResponseSchema>;

export const botConfigDeleteResponseSchema = z.object({ ok: z.literal(true) });
export type BotConfigDeleteResponse = z.infer<typeof botConfigDeleteResponseSchema>;
