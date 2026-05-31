/**
 * Telegram Web App `initData` verification.
 *
 * When the web client is opened as a Telegram Mini App, Telegram injects a
 * signed `initData` query string into `window.Telegram.WebApp`. The client
 * POSTs it verbatim to `/api/auth/telegram`; this module proves it was
 * minted by Telegram for *our* bot and extracts the calling user.
 *
 * Verification (per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   1. Parse the query string and pull out the `hash` field.
 *   2. Build the data-check-string: the remaining `key=value` pairs sorted
 *      by key, joined with `\n`.
 *   3. secret_key = HMAC-SHA256(key = "WebAppData", data = bot_token)
 *   4. expected  = hex(HMAC-SHA256(key = secret_key, data = data-check-string))
 *   5. constant-time compare `expected` with the supplied `hash`.
 *   6. reject payloads older than `maxAgeSec` via `auth_date`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Subset of the Telegram WebApp `user` object we care about. */
export interface TelegramWebAppUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

export type VerifyInitDataResult =
  | { ok: true; user: TelegramWebAppUser; authDate: Date }
  | { ok: false; reason: string };

export interface VerifyInitDataOptions {
  /** Reject initData whose `auth_date` is older than this many seconds. Default 24h. */
  maxAgeSec?: number;
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: () => number;
}

const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: VerifyInitDataOptions = {},
): VerifyInitDataResult {
  if (!initData || !botToken) return { ok: false, reason: 'missing initData or bot token' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed initData' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'initData missing hash' };

  // Data-check-string: every field except `hash`, sorted by key, `key=value`
  // joined by newlines (`signature` stays in — the HMAC base excludes only `hash`).
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Hash both sides to equal-width digests for the constant-time compare.
  const a = createHmac('sha256', secretKey).update(expectedHash).digest();
  const b = createHmac('sha256', secretKey).update(hash).digest();
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'initData signature mismatch' };

  // `auth_date` is unix seconds.
  const authDateRaw = params.get('auth_date');
  const authDateSec = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDateSec)) return { ok: false, reason: 'initData missing auth_date' };
  const maxAgeSec = options.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
  const nowSec = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (nowSec - authDateSec > maxAgeSec) return { ok: false, reason: 'initData expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'initData missing user' };
  let user: TelegramWebAppUser;
  try {
    const parsed = JSON.parse(userRaw) as {
      id?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      username?: unknown;
    };
    if (parsed.id === undefined || parsed.id === null) {
      return { ok: false, reason: 'initData user missing id' };
    }
    // Telegram ids can exceed JS's safe-integer range, so take the exact
    // digits from the raw JSON text rather than the (lossy) parsed number.
    const idMatch = /"id"\s*:\s*(-?\d+)/.exec(userRaw);
    user = {
      id: idMatch ? idMatch[1]! : String(parsed.id),
      firstName: typeof parsed.first_name === 'string' ? parsed.first_name : null,
      lastName: typeof parsed.last_name === 'string' ? parsed.last_name : null,
      username: typeof parsed.username === 'string' ? parsed.username : null,
    };
  } catch {
    return { ok: false, reason: 'initData user is not valid JSON' };
  }

  return { ok: true, user, authDate: new Date(authDateSec * 1000) };
}
