import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { parseConfig, type Config } from '../config.js';
import { writeBotConfig } from '../db/botConfigRepo.js';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { BOT_TOKEN_AAD, encryptSecret, getKeyFingerprint } from '../lib/sessionCrypto.js';
import { buildBotConfigInfo, resolvePublicUrl, resolveTelegramAuth } from './botConfig.js';

const logger = createLogger({ silent: true });
const ENV_TOKEN = '111111:ENVtokenABCDEFGHIJKLMNOPQRSTUVWXYZ012';
const DB_TOKEN = '222222:DBtokenABCDEFGHIJKLMNOPQRSTUVWXYZ0123';

let handles: TestDbHandle[] = [];
afterEach(() => {
  for (const h of handles) h.close();
  handles = [];
});

function ctx(env: Record<string, string> = {}): { cfg: Config; db: Db } {
  const handle = createTestDb();
  handles.push(handle);
  return { cfg: parseConfig(env), db: handle.db };
}

function keyEnv(key: Buffer): Record<string, string> {
  return { TG_SESSION_ENCRYPTION_KEY: key.toString('base64') };
}

describe('resolveTelegramAuth', () => {
  it('uses env token + admins when nothing is stored', () => {
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111,222' });
    expect(resolveTelegramAuth({ cfg, db, logger })).toEqual({
      botToken: ENV_TOKEN,
      adminIds: ['111', '222'],
    });
  });

  it('prefers the DB token (decryptable with the current key) over env', () => {
    const key = randomBytes(32);
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111', ...keyEnv(key) });
    writeBotConfig(db, { token: encryptSecret(DB_TOKEN, key, BOT_TOKEN_AAD) });
    expect(resolveTelegramAuth({ cfg, db, logger })?.botToken).toBe(DB_TOKEN);
  });

  it('falls back to env when the stored token uses a different key', () => {
    const storedKey = randomBytes(32);
    const currentKey = randomBytes(32);
    const { cfg, db } = ctx({
      TG_BOT_TOKEN: ENV_TOKEN,
      TG_BOT_ADMIN_IDS: '111',
      ...keyEnv(currentKey),
    });
    writeBotConfig(db, { token: encryptSecret(DB_TOKEN, storedKey, BOT_TOKEN_AAD) });
    expect(resolveTelegramAuth({ cfg, db, logger })?.botToken).toBe(ENV_TOKEN);
  });

  it('falls back to env when no encryption key is configured', () => {
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111' });
    writeBotConfig(db, { token: { ciphertext: 'AAAA', keyFingerprint: 'deadbeefdeadbeef' } });
    expect(resolveTelegramAuth({ cfg, db, logger })?.botToken).toBe(ENV_TOKEN);
  });

  it('falls back to env when the stored token fails to decrypt (matching fingerprint)', () => {
    const key = randomBytes(32);
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111', ...keyEnv(key) });
    // Corrupt ciphertext but the fingerprint matches the configured key.
    writeBotConfig(db, {
      token: { ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA', keyFingerprint: getKeyFingerprint(key) },
    });
    expect(resolveTelegramAuth({ cfg, db, logger })?.botToken).toBe(ENV_TOKEN);
  });

  it('prefers DB admins over env', () => {
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111' });
    writeBotConfig(db, { admins: [{ id: '999', displayName: 'Boss', username: 'boss' }] });
    expect(resolveTelegramAuth({ cfg, db, logger })?.adminIds).toEqual(['999']);
  });

  it('ignores an empty DB admin list and uses env', () => {
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN, TG_BOT_ADMIN_IDS: '111' });
    writeBotConfig(db, { admins: [] });
    expect(resolveTelegramAuth({ cfg, db, logger })?.adminIds).toEqual(['111']);
  });

  it('returns null when no token resolves', () => {
    const { cfg, db } = ctx({});
    expect(resolveTelegramAuth({ cfg, db, logger })).toBeNull();
  });

  it('returns null when a token resolves but no admins do', () => {
    const { cfg, db } = ctx({ TG_BOT_TOKEN: ENV_TOKEN });
    expect(resolveTelegramAuth({ cfg, db, logger })).toBeNull();
  });
});

describe('resolvePublicUrl', () => {
  it('prefers the DB value over env', () => {
    const { cfg, db } = ctx({ PUBLIC_URL: 'https://env.example.com' });
    expect(resolvePublicUrl({ cfg, db })).toBe('https://env.example.com');
    writeBotConfig(db, { publicUrl: 'https://db.example.com' });
    expect(resolvePublicUrl({ cfg, db })).toBe('https://db.example.com');
  });

  it('is undefined when neither is set', () => {
    const { cfg, db } = ctx({});
    expect(resolvePublicUrl({ cfg, db })).toBeUndefined();
  });
});

describe('buildBotConfigInfo', () => {
  it('reports env sources and no key', () => {
    const { cfg, db } = ctx({
      TG_BOT_TOKEN: ENV_TOKEN,
      TG_BOT_ADMIN_IDS: '111',
      PUBLIC_URL: 'https://e.example.com',
    });
    const info = buildBotConfigInfo({ cfg, db, getBotRunning: () => false });
    expect(info).toMatchObject({
      tokenConfigured: true,
      tokenSource: 'env',
      encryptionKeyConfigured: false,
      keyFingerprintMismatch: false,
      admins: [{ id: '111', displayName: null, username: null }],
      adminsSource: 'env',
      publicUrl: 'https://e.example.com',
      publicUrlSource: 'env',
      botRunning: false,
    });
    // The masked view must never carry the token itself.
    expect(JSON.stringify(info)).not.toContain(ENV_TOKEN);
  });

  it('reports db token source + running when stored with a matching key', () => {
    const key = randomBytes(32);
    const { cfg, db } = ctx({ ...keyEnv(key) });
    writeBotConfig(db, {
      token: encryptSecret(DB_TOKEN, key, BOT_TOKEN_AAD),
      admins: [{ id: '7', displayName: null, username: null }],
    });
    const info = buildBotConfigInfo({
      cfg,
      db,
      getEncryptionKey: () => key,
      getBotRunning: () => true,
    });
    expect(info.tokenSource).toBe('db');
    expect(info.keyFingerprintMismatch).toBe(false);
    expect(info.encryptionKeyConfigured).toBe(true);
    expect(info.botRunning).toBe(true);
    expect(JSON.stringify(info)).not.toContain(DB_TOKEN);
  });

  it('flags a key fingerprint mismatch and falls the source through to env', () => {
    const storedKey = randomBytes(32);
    const currentKey = randomBytes(32);
    const { cfg, db } = ctx({
      TG_BOT_TOKEN: ENV_TOKEN,
      TG_BOT_ADMIN_IDS: '1',
      ...keyEnv(currentKey),
    });
    writeBotConfig(db, { token: encryptSecret(DB_TOKEN, storedKey, BOT_TOKEN_AAD) });
    const info = buildBotConfigInfo({
      cfg,
      db,
      getEncryptionKey: () => currentKey,
      getBotRunning: () => false,
    });
    expect(info.keyFingerprintMismatch).toBe(true);
    expect(info.tokenSource).toBe('env');
  });
});
