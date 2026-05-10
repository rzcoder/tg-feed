/**
 * AES-256-GCM helpers for the Telegram session blob stored in
 * `telegram_account.encrypted_session_string`.
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

export function encryptSessionString(plain: string, key: Buffer): EncryptedEnvelope {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyFingerprint: getKeyFingerprint(key),
  };
}

export function decryptSessionString(envelope: EncryptedEnvelope, key: Buffer): string {
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
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
