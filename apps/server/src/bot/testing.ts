/**
 * Test helpers for the Telegram Web App auth flow. `signInitData` reproduces
 * Telegram's signing so tests can mint valid `initData` payloads (and, by
 * mutating them, invalid ones).
 */
import { createHmac } from 'node:crypto';

export const TEST_BOT_TOKEN = '123456:test-bot-token';

/** Build a correctly-signed initData query string from the given fields. */
export function signInitData(fields: Record<string, string>, token = TEST_BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
