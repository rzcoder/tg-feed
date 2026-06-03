// The only module that reads process.env; everything else imports the parsed `config`. Fields are optional so the app boots (and migrations run) before they're filled in.
import { z } from 'zod';

const envSchema = z.object({
  // --- Server ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Database ---
  DATABASE_PATH: z.string().min(1).default('./data/tg-feed.sqlite'),

  // --- Telegram ---
  TG_API_ID: z.coerce.number().int().positive().optional(),
  TG_API_HASH: z.string().min(1).optional(),
  TG_SESSION_STRING: z.string().min(1).optional(),
  // base64 32 bytes; when set, DB-stored accounts (encrypted at rest) win over TG_SESSION_STRING, else account writes are refused. Fingerprint travels in exports so a mismatched-key import skips the blob.
  // Generate: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
  TG_SESSION_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/, 'expected base64')
    .refine((s) => Buffer.from(s, 'base64').length === 32, 'must decode to 32 bytes')
    .optional(),

  // --- Web auth ---
  WEB_PASSWORD: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),

  // --- Telegram Web App bot ---
  // @BotFather token; with TG_BOT_ADMIN_IDS set, enables Mini App login + /start bot (password login stays as fallback).
  TG_BOT_TOKEN: z.string().min(1).optional(),
  // Comma-separated admin user ids → deduped string[]; compared as strings to keep 64-bit ids lossless. Empty disables Telegram login.
  TG_BOT_ADMIN_IDS: z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? Array.from(
            new Set(
              raw
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            ),
          )
        : [],
    ),
  // Public HTTPS base URL the web client is served from; the bot's menu/start buttons point here.
  PUBLIC_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as missing: dotenv parses `KEY=` as "" which our .min/regex optionals reject.
  const cleaned: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const config: Config = parseConfig();
