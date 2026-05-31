/**
 * Single source of truth for environment configuration.
 *
 * Per docs/AGENTS.md, this is the ONLY module that reads `process.env`.
 * Everything else imports the parsed `config` object.
 *
 * Fields consumed by later chapters are marked optional so the app boots
 * (and migrations run) without filling them in. They tighten to required
 * in the chapter that actually uses them.
 */
import { z } from 'zod';

const envSchema = z.object({
  // --- Server ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Database ---
  DATABASE_PATH: z.string().min(1).default('./data/tg-feed.sqlite'),

  // --- Telegram (Chapter 3) ---
  TG_API_ID: z.coerce.number().int().positive().optional(),
  TG_API_HASH: z.string().min(1).optional(),
  TG_SESSION_STRING: z.string().min(1).optional(),
  // Base64-encoded 32 random bytes. When set, the settings page can store a
  // signed-in Telegram account in the DB (encrypted at rest with this key)
  // and the app prefers that account over `TG_SESSION_STRING`. When unset,
  // the app falls back to env-only and refuses to write account rows. The
  // key fingerprint travels in exports so an import on a host with a
  // different key skips the encrypted blob with a clear warning. Generate:
  //   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
  TG_SESSION_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/, 'expected base64')
    .refine((s) => Buffer.from(s, 'base64').length === 32, 'must decode to 32 bytes')
    .optional(),

  // --- Web auth (Chapter 7) ---
  WEB_PASSWORD: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),

  // --- Telegram Web App bot ---
  // Bot token from @BotFather. When set together with TG_BOT_ADMIN_IDS, the
  // web client can be opened as a Telegram Mini App and the admin is signed
  // in by their Telegram account (the password login stays as a fallback).
  // The bot also runs a long-poll loop that answers /start with a button to
  // open the web client. Treat the token as a credential — it's never logged.
  TG_BOT_TOKEN: z.string().min(1).optional(),
  // Comma-separated Telegram user ids allowed to sign in via the Mini App and
  // command the bot. Parsed into a deduped string[] (ids are compared as
  // strings so future 64-bit ids stay lossless). Empty / unset disables the
  // Telegram-account login path entirely.
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
  // Public HTTPS base URL the web client is served from (e.g.
  // https://tg-feed.example.com). Telegram requires HTTPS for Mini Apps. Used
  // at boot to point the bot's menu button and /start button at the client.
  PUBLIC_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // dotenv parses `KEY=` as the empty string, but our optional fields use
  // `.min(N)` / regex constraints that reject `""`. Treat empty strings as
  // missing so a placeholder line in `.env` doesn't break startup.
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
