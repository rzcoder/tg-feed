// Wire schemas for the DB-backed bot config (Settings → Bot). GET is masked (never returns the token); token/admins/publicUrl each resolve DB-first with an env fallback, hence the per-field *Source.
import { z } from 'zod';

export const botConfigSourceSchema = z.enum(['db', 'env']);
export type BotConfigSource = z.infer<typeof botConfigSourceSchema>;

// BotFather token <bot_id>:<auth>; loose enough to survive a format tweak, tight enough to reject junk.
export const botTokenSchema = z
  .string()
  .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'expected a BotFather token like 12345:ABC...');

// 64-bit ids kept as strings to stay lossless; deduped server-side.
export const botAdminIdSchema = z.string().regex(/^\d+$/, 'expected a numeric Telegram user id');

// display fields are null for env admins (raw ids, no @username lookup).
export const botAdminSchema = z.object({
  id: botAdminIdSchema,
  displayName: z.string().nullable(),
  username: z.string().nullable(),
});
export type BotAdmin = z.infer<typeof botAdminSchema>;

export const botConfigInfoSchema = z.object({
  tokenConfigured: z.boolean(),
  tokenSource: botConfigSourceSchema.nullable(),
  // Gates token writes.
  encryptionKeyConfigured: z.boolean(),
  // DB token encrypted under a different key than the current one; resolver falls through to env.
  keyFingerprintMismatch: z.boolean(),
  admins: z.array(botAdminSchema),
  adminsSource: botConfigSourceSchema.nullable(),
  publicUrl: z.string().nullable(),
  publicUrlSource: botConfigSourceSchema.nullable(),
  botRunning: z.boolean(),
});
export type BotConfigInfo = z.infer<typeof botConfigInfoSchema>;

// Partial update, ≥1 field: omitted = unchanged, null = clear (fall back to env), value = set; `admins` is the full desired list.
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

// resolve-admin: preview only, resolves @username / t.me / id to a Telegram user (rejects channels/groups).
export const resolveBotAdminRequestSchema = z.object({
  query: z.string().min(1).max(128),
});
export type ResolveBotAdminRequest = z.infer<typeof resolveBotAdminRequestSchema>;

export const resolveBotAdminResponseSchema = botAdminSchema;
export type ResolveBotAdminResponse = z.infer<typeof resolveBotAdminResponseSchema>;

export const botConfigDeleteResponseSchema = z.object({ ok: z.literal(true) });
export type BotConfigDeleteResponse = z.infer<typeof botConfigDeleteResponseSchema>;
