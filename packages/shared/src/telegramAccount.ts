import { z } from 'zod';

export const telegramAccountSourceSchema = z.enum(['db', 'env']);
export type TelegramAccountSource = z.infer<typeof telegramAccountSourceSchema>;

export const telegramAccountInfoSchema = z.object({
  present: z.boolean(),
  source: telegramAccountSourceSchema.nullable(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  telegramUserId: z.string().nullable(),
  // data:image/jpeg;base64 URL; null when unavailable (defaulted so older payloads parse)
  avatarDataUrl: z.string().nullable().default(null),
  encryptionKeyConfigured: z.boolean(),
  // row exists but keyFingerprint != current key; resolver falls through to env/degraded
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
  // Reject non-StringSession-alphabet input up-front so the route 400s instead of burning a TG connection (502).
  sessionString: z
    .string()
    .min(8)
    .max(8192)
    .regex(/^[A-Za-z0-9+/=_-]+$/, 'invalid character in session string'),
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
