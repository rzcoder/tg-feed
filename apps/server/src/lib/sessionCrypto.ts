/**
 * AES-256-GCM helpers for secrets stored at rest — the Telegram session
 * blob in `telegram_account.encrypted_session_string` and the bot token in
 * `app_settings` key `'bot'`.
 *
 * Wire format: `base64(iv(12) || authTag(16) || ciphertext)`.
 * Key: 32 raw bytes, supplied as base64 in `TG_SESSION_ENCRYPTION_KEY`.
 *
 * The fingerprint (first 16 hex chars of `sha256(key)`) lets exports
 * advertise *which* key they were encrypted with so an import on a host
 * with a different key can skip the row instead of attempting (and
 * silently failing on) decryption. 64 bits is enough to detect mismatch
 * with no realistic collision risk; not enough to be a brute-force lever
 * against the underlying 256-bit key.
 *
 * Each blob is bound to a stable AAD label identifying the field it belongs
 * to (`encryptSecret`/`decryptSecret`), so a valid ciphertext can't be
 * swapped between fields (e.g. session string ↔ bot token) without the GCM
 * tag failing. The two session-string wrappers keep the original AAD plus a
 * legacy no-AAD decrypt path for blobs written before AAD binding existed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';

export interface EncryptedEnvelope {
  /** base64(iv ‖ authTag ‖ ciphertext) */
  ciphertext: string;
  /** First 16 hex chars of sha256(key). */
  keyFingerprint: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** AAD for the Telegram session blob in `telegram_account`. */
export const TELEGRAM_ACCOUNT_AAD = 'tg-feed/telegram_account/v1';
/** AAD for the bot token in `app_settings` key `'bot'`. */
export const BOT_TOKEN_AAD = 'tg-feed/bot_token/v1';

/**
 * Returns the decoded encryption key as a 32-byte Buffer, or null when the
 * env var is not set. Throws if the var is set but malformed — config-time
 * validation in `config.ts` already enforces base64 + length, but this is
 * the second line of defence (and the runtime-typed return).
 */
export function loadEncryptionKey(cfg: Config): Buffer | null {
  if (!cfg.TG_SESSION_ENCRYPTION_KEY) return null;
  const buf = Buffer.from(cfg.TG_SESSION_ENCRYPTION_KEY, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `TG_SESSION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${buf.length}`,
    );
  }
  return buf;
}

export function getKeyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Encrypt `plain` under `key`, binding the ciphertext to `aad` (a stable
 * label identifying the field). The same `aad` must be supplied to decrypt.
 */
export function encryptSecret(plain: string, key: Buffer, aad: string): EncryptedEnvelope {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyFingerprint: getKeyFingerprint(key),
  };
}

/**
 * Low-level GCM open. `aad === null` decrypts without binding (legacy
 * pre-AAD blobs). Throws on a truncated envelope or a tag mismatch.
 */
function openEnvelope(envelope: EncryptedEnvelope, key: Buffer, aad: string | null): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  }
  const buf = Buffer.from(envelope.ciphertext, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('ciphertext is truncated');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  if (aad !== null) decipher.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Decrypt a blob produced by `encryptSecret` with the same `aad`. */
export function decryptSecret(envelope: EncryptedEnvelope, key: Buffer, aad: string): string {
  return openEnvelope(envelope, key, aad);
}

export function encryptSessionString(plain: string, key: Buffer): EncryptedEnvelope {
  return encryptSecret(plain, key, TELEGRAM_ACCOUNT_AAD);
}

export function decryptSessionString(envelope: EncryptedEnvelope, key: Buffer): string {
  // Try with AAD first; fall back to no-AAD so envelopes produced by
  // pre-v1 versions of this module (no AAD) still decrypt. The legacy
  // path will be removed once all stored ciphertexts are re-encrypted.
  try {
    return openEnvelope(envelope, key, TELEGRAM_ACCOUNT_AAD);
  } catch {
    return openEnvelope(envelope, key, null);
  }
}
