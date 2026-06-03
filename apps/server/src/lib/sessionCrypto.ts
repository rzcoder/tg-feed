// AES-256-GCM for secrets at rest. Wire: base64(iv(12) ‖ authTag(16) ‖ ciphertext).
// Per-field AAD binds a ciphertext to its field so it can't be swapped (session string ↔ bot token).
// 64-bit key fingerprint lets a cross-host import skip rows it can't decrypt; too short to brute-force the key.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';

export interface EncryptedEnvelope {
  ciphertext: string;
  keyFingerprint: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const TELEGRAM_ACCOUNT_AAD = 'tg-feed/telegram_account/v1';
export const BOT_TOKEN_AAD = 'tg-feed/bot_token/v1';

// null when unset; throws if malformed — backstop behind config.ts's base64/length check.
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

// aad === null decrypts without binding (legacy pre-AAD blobs).
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

export function decryptSecret(envelope: EncryptedEnvelope, key: Buffer, aad: string): string {
  return openEnvelope(envelope, key, aad);
}

export function encryptSessionString(plain: string, key: Buffer): EncryptedEnvelope {
  return encryptSecret(plain, key, TELEGRAM_ACCOUNT_AAD);
}

export function decryptSessionString(envelope: EncryptedEnvelope, key: Buffer): string {
  // Fall back to no-AAD so pre-v1 (no-AAD) blobs still decrypt.
  try {
    return openEnvelope(envelope, key, TELEGRAM_ACCOUNT_AAD);
  } catch {
    return openEnvelope(envelope, key, null);
  }
}
