/**
 * Wire-format schemas for the in-app Telegram sign-in flow exposed by
 * `apps/server/src/api/routes/telegramAccount.ts` and consumed by the
 * Settings page.
 */
import { z } from 'zod';

/** Source of the currently-active session. */
export const telegramAccountSourceSchema = z.enum(['db', 'env']);
export type TelegramAccountSource = z.infer<typeof telegramAccountSourceSchema>;

export const telegramAccountInfoSchema = z.object({
  /** True when the resolver successfully picked up a session (DB or env). */
  present: z.boolean(),
  source: telegramAccountSourceSchema.nullable(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  telegramUserId: z.string().nullable(),
  /** Whether `TG_SESSION_ENCRYPTION_KEY` is configured. */
  encryptionKeyConfigured: z.boolean(),
  /**
   * True when a row exists in `telegram_account` but its `keyFingerprint`
   * doesn't match the current key. The resolver falls through to env (or
   * degraded mode); the UI surfaces a "key mismatch" hint and offers to
   * sign out + re-add.
   */
  keyFingerprintMismatch: z.boolean(),
});
export type TelegramAccountInfo = z.infer<typeof telegramAccountInfoSchema>;

// --- Login: phone-code flow ---------------------------------------------

// Telegram phone numbers are international; allow `+` plus 6–20 digits.
export const telegramPhoneNumberSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^\+?\d{6,20}$/, 'expected an international phone number');

export const telegramLoginStartRequestSchema = z.object({
  phoneNumber: telegramPhoneNumberSchema,
});
export type TelegramLoginStartRequest = z.infer<typeof telegramLoginStartRequestSchema>;

export const telegramLoginStartResponseSchema = z.object({
  sessionId: z.string().min(1),
});
export type TelegramLoginStartResponse = z.infer<typeof telegramLoginStartResponseSchema>;

// Login codes are 4–8 digits in current Telegram protocol.
export const telegramLoginCodeSchema = z.string().regex(/^\d{4,8}$/);

export const telegramLoginVerifyRequestSchema = z.object({
  sessionId: z.string().min(1),
  code: telegramLoginCodeSchema,
});
export type TelegramLoginVerifyRequest = z.infer<typeof telegramLoginVerifyRequestSchema>;

// Discriminated on `done` so the client narrows correctly: either the
// flow completed (and we return the new account info), or 2FA is needed
// next.
export const telegramLoginCompletedSchema = z.object({
  done: z.literal(true),
  account: telegramAccountInfoSchema,
});
export type TelegramLoginCompleted = z.infer<typeof telegramLoginCompletedSchema>;

export const telegramLoginNeedsPasswordSchema = z.object({
  done: z.literal(false),
  needsPassword: z.literal(true),
});
export type TelegramLoginNeedsPassword = z.infer<typeof telegramLoginNeedsPasswordSchema>;

export const telegramLoginVerifyResponseSchema = z.discriminatedUnion('done', [
  telegramLoginCompletedSchema,
  telegramLoginNeedsPasswordSchema,
]);
export type TelegramLoginVerifyResponse = z.infer<typeof telegramLoginVerifyResponseSchema>;

export const telegramLoginPasswordRequestSchema = z.object({
  sessionId: z.string().min(1),
  password: z.string().min(1).max(256),
});
export type TelegramLoginPasswordRequest = z.infer<typeof telegramLoginPasswordRequestSchema>;

export const telegramLoginPasswordResponseSchema = telegramLoginCompletedSchema;
export type TelegramLoginPasswordResponse = z.infer<typeof telegramLoginPasswordResponseSchema>;

// --- Login: raw-paste flow ----------------------------------------------

export const telegramLoginRawRequestSchema = z.object({
  sessionString: z.string().min(8).max(8192),
});
export type TelegramLoginRawRequest = z.infer<typeof telegramLoginRawRequestSchema>;

export const telegramLoginRawResponseSchema = telegramLoginCompletedSchema;
export type TelegramLoginRawResponse = z.infer<typeof telegramLoginRawResponseSchema>;

// --- Cancel / delete ----------------------------------------------------

export const telegramLoginCancelRequestSchema = z.object({
  sessionId: z.string().min(1),
});
export type TelegramLoginCancelRequest = z.infer<typeof telegramLoginCancelRequestSchema>;

export const telegramLoginCancelResponseSchema = z.object({
  ok: z.literal(true),
});
export type TelegramLoginCancelResponse = z.infer<typeof telegramLoginCancelResponseSchema>;

export const telegramAccountDeleteResponseSchema = z.object({
  ok: z.literal(true),
});
export type TelegramAccountDeleteResponse = z.infer<typeof telegramAccountDeleteResponseSchema>;
