import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSessionString,
  encryptSessionString,
  getKeyFingerprint,
  loadEncryptionKey,
} from './sessionCrypto.js';
import type { Config } from '../config.js';

function makeKey(): Buffer {
  return randomBytes(32);
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'info',
    DATABASE_PATH: ':memory:',
    ...overrides,
  } as Config;
}

describe('sessionCrypto', () => {
  it('round-trips an arbitrary session string', () => {
    const key = makeKey();
    const plain = '1ABCDEFGHIJK0123456789xyzAndSomeBase64==';
    const env = encryptSessionString(plain, key);
    expect(decryptSessionString(env, key)).toBe(plain);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const key = makeKey();
    const plain = 'same input';
    const a = encryptSessionString(plain, key);
    const b = encryptSessionString(plain, key);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.keyFingerprint).toBe(b.keyFingerprint);
  });

  it('throws when decrypting with the wrong key', () => {
    const key = makeKey();
    const wrong = makeKey();
    const env = encryptSessionString('payload', key);
    expect(() => decryptSessionString(env, wrong)).toThrow();
  });

  it('throws when the auth tag is tampered with', () => {
    const key = makeKey();
    const env = encryptSessionString('payload', key);
    const buf = Buffer.from(env.ciphertext, 'base64');
    buf[12] = buf[12]! ^ 0xff; // flip a byte inside the auth tag region
    const tampered = { ...env, ciphertext: buf.toString('base64') };
    expect(() => decryptSessionString(tampered, key)).toThrow();
  });

  it('throws on truncated ciphertext', () => {
    const key = makeKey();
    expect(() => decryptSessionString({ ciphertext: 'AAAA', keyFingerprint: 'x' }, key)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    const tooShort = Buffer.alloc(16);
    expect(() => encryptSessionString('x', tooShort)).toThrow();
  });

  it('fingerprint is stable for the same key', () => {
    const key = makeKey();
    expect(getKeyFingerprint(key)).toBe(getKeyFingerprint(key));
    expect(getKeyFingerprint(key)).toHaveLength(16);
  });

  it('fingerprint differs for different keys', () => {
    expect(getKeyFingerprint(makeKey())).not.toBe(getKeyFingerprint(makeKey()));
  });

  it('loadEncryptionKey returns null when env var is missing', () => {
    expect(loadEncryptionKey(makeConfig())).toBeNull();
  });

  it('loadEncryptionKey decodes a valid base64 key', () => {
    const raw = makeKey();
    const key = loadEncryptionKey(
      makeConfig({ TG_SESSION_ENCRYPTION_KEY: raw.toString('base64') }),
    );
    expect(key).not.toBeNull();
    expect(key!.equals(raw)).toBe(true);
  });

  it('loadEncryptionKey throws on a key that decodes to the wrong length', () => {
    expect(() =>
      loadEncryptionKey(
        makeConfig({ TG_SESSION_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
      ),
    ).toThrow();
  });
});
