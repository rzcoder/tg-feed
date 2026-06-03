// Settings-page Telegram sign-in/out. Save needs TG_SESSION_ENCRYPTION_KEY (else 412); login sessions are bound to the caller's cookie token so a second tab can't drive someone else's flow.
import type { FastifyInstance } from 'fastify';
import {
  type TelegramAccountInfo,
  type TelegramLoginCancelResponse,
  type TelegramLoginCompleted,
  telegramLoginCancelRequestSchema,
  telegramLoginPasswordRequestSchema,
  telegramLoginRawRequestSchema,
  telegramLoginStartRequestSchema,
  telegramLoginVerifyRequestSchema,
  type TelegramLoginVerifyResponse,
  type TelegramStatus,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { deleteAccount, getActiveAccount, upsertAccount } from '../../db/telegramAccountRepo.js';
import { AppError } from '../../lib/errors.js';
import { encryptSessionString, getKeyFingerprint } from '../../lib/sessionCrypto.js';
import type { LoginAccountInfo, LoginSessionStore } from '../../tg/loginSession.js';
import type { ProfilePhotoFetcher } from '../../tg/profilePhoto.js';
import { readSessionToken } from '../auth.js';

export interface RegisterTelegramAccountRoutesDeps {
  db: Db;
  getEncryptionKey?: () => Buffer | null;
  loginSessionStore?: LoginSessionStore;
  reloadTelegramSession?: () => Promise<void>;
  getTelegramStatus: () => TelegramStatus;
  // Over the live userbot; absent when no client is up (tests / disconnected).
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
}

const AVATAR_TTL_MS = 10 * 60_000;
const AVATAR_FETCH_TIMEOUT_MS = 2500;

// Resolves to null after the timeout so a stalled download can't hang the route.
function avatarFetchTimeout(): Promise<null> {
  return new Promise<null>((resolve) => {
    const t = setTimeout(() => resolve(null), AVATAR_FETCH_TIMEOUT_MS);
    if (typeof t.unref === 'function') t.unref();
  });
}

export function registerTelegramAccountRoutes(
  app: FastifyInstance,
  deps: RegisterTelegramAccountRoutesDeps,
): void {
  const {
    db,
    getEncryptionKey,
    loginSessionStore,
    reloadTelegramSession,
    getTelegramStatus,
    getFetchProfilePhoto,
  } = deps;

  // Userbot's own avatar, lazy + short-TTL cached; cleared on sign-in/out.
  let avatarCache: { key: string; dataUrl: string | null; fetchedAt: number } | null = null;

  async function resolveAvatar(base: TelegramAccountInfo): Promise<string | null> {
    if (!base.present || getTelegramStatus().state !== 'connected') return null;
    const key = base.telegramUserId ?? 'me';
    const nowMs = Date.now();
    if (avatarCache && avatarCache.key === key && nowMs - avatarCache.fetchedAt < AVATAR_TTL_MS) {
      return avatarCache.dataUrl;
    }
    const fetcher = getFetchProfilePhoto?.();
    // No live client: keep any same-account cached value rather than dropping it.
    if (!fetcher) return avatarCache?.key === key ? avatarCache.dataUrl : null;
    let dataUrl: string | null = null;
    try {
      dataUrl = await Promise.race([fetcher('me'), avatarFetchTimeout()]);
    } catch {
      dataUrl = null;
    }
    avatarCache = { key, dataUrl, fetchedAt: nowMs };
    return dataUrl;
  }

  async function accountInfo(): Promise<TelegramAccountInfo> {
    const base = buildAccountInfo({
      db,
      ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
      getTelegramStatus,
    });
    return { ...base, avatarDataUrl: await resolveAvatar(base) };
  }

  app.get('/tg/account', async (): Promise<TelegramAccountInfo> => accountInfo());

  app.post(
    '/tg/login/start',
    {
      // Cap SendCode rate: repeated starts can shadow-ban the operator's phone.
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (request) => {
      requireKeyConfigured(getEncryptionKey);
      const store = requireStore(loginSessionStore);
      const body = telegramLoginStartRequestSchema.parse(request.body);
      const owner = readSessionToken(request) ?? '';
      return store.start(body.phoneNumber, owner);
    },
  );

  app.post(
    '/tg/login/verify',
    {
      // SMS-code brute-force shadow-bans the phone (counted per phone+app, not per IP).
      config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
    },
    async (request): Promise<TelegramLoginVerifyResponse> => {
      requireKeyConfigured(getEncryptionKey);
      const store = requireStore(loginSessionStore);
      const body = telegramLoginVerifyRequestSchema.parse(request.body);
      const owner = readSessionToken(request) ?? '';
      const result = await store.verifyCode(body.sessionId, body.code, owner);
      if ('needsPassword' in result) {
        return { done: false, needsPassword: true };
      }
      await commitLogin({
        db,
        ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
        info: result.account,
        ...(reloadTelegramSession !== undefined ? { reloadTelegramSession } : {}),
      });
      avatarCache = null;
      return { done: true, account: await accountInfo() };
    },
  );

  app.post(
    '/tg/login/password',
    {
      // Cap 2FA-password rate; the operator pays for upstream brute-force throttling.
      config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
    },
    async (request): Promise<TelegramLoginCompleted> => {
      requireKeyConfigured(getEncryptionKey);
      const store = requireStore(loginSessionStore);
      const body = telegramLoginPasswordRequestSchema.parse(request.body);
      const owner = readSessionToken(request) ?? '';
      const result = await store.verifyPassword(body.sessionId, body.password, owner);
      await commitLogin({
        db,
        ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
        info: result.account,
        ...(reloadTelegramSession !== undefined ? { reloadTelegramSession } : {}),
      });
      avatarCache = null;
      return { done: true, account: await accountInfo() };
    },
  );

  app.post('/tg/login/raw', async (request): Promise<TelegramLoginCompleted> => {
    requireKeyConfigured(getEncryptionKey);
    const store = requireStore(loginSessionStore);
    const body = telegramLoginRawRequestSchema.parse(request.body);
    const info = await store.validateRaw(body.sessionString);
    await commitLogin({
      db,
      ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
      info,
      ...(reloadTelegramSession !== undefined ? { reloadTelegramSession } : {}),
    });
    avatarCache = null;
    return { done: true, account: await accountInfo() };
  });

  app.post('/tg/login/cancel', async (request): Promise<TelegramLoginCancelResponse> => {
    const store = requireStore(loginSessionStore);
    const body = telegramLoginCancelRequestSchema.parse(request.body);
    const owner = readSessionToken(request) ?? '';
    await store.cancel(body.sessionId, owner);
    return { ok: true };
  });

  app.delete('/tg/account', async (): Promise<{ ok: true }> => {
    deleteAccount(db);
    avatarCache = null;
    if (reloadTelegramSession) {
      // Live-swap to env; failures don't block (row's gone, next boot picks up env).
      await reloadTelegramSession().catch(() => {});
    }
    return { ok: true };
  });
}

// --- helpers --------------------------------------------------------------

function buildAccountInfo(deps: {
  db: Db;
  getEncryptionKey?: () => Buffer | null;
  getTelegramStatus: () => TelegramStatus;
}): TelegramAccountInfo {
  const key = deps.getEncryptionKey?.() ?? null;
  const row = getActiveAccount(deps.db);
  const status = deps.getTelegramStatus();
  const connected = status.state === 'connected';
  // Fingerprint mismatch (or no key) = stale row, resolver fell through to env; reported separately so the UI can prompt.
  const rowUsable = row !== null && key !== null && getKeyFingerprint(key) === row.keyFingerprint;
  const source: 'db' | 'env' | null = !connected ? null : rowUsable ? 'db' : 'env';

  if (rowUsable && row) {
    return {
      present: true,
      source,
      displayName: row.displayName,
      username: row.username,
      phoneNumber: row.phoneNumber,
      telegramUserId: row.telegramUserId,
      // Filled by the caller (accountInfo) from the live client.
      avatarDataUrl: null,
      encryptionKeyConfigured: true,
      keyFingerprintMismatch: false,
    };
  }

  return {
    present: connected,
    source,
    displayName: null,
    username: null,
    phoneNumber: null,
    telegramUserId: null,
    avatarDataUrl: null,
    encryptionKeyConfigured: key !== null,
    keyFingerprintMismatch: row !== null && !rowUsable,
  };
}

async function commitLogin(deps: {
  db: Db;
  getEncryptionKey?: () => Buffer | null;
  info: LoginAccountInfo;
  reloadTelegramSession?: () => Promise<void>;
}): Promise<void> {
  const key = deps.getEncryptionKey?.() ?? null;
  if (!key) {
    throw new AppError(
      412,
      'encryption_key_missing',
      'TG_SESSION_ENCRYPTION_KEY is not configured',
    );
  }
  const envelope = encryptSessionString(deps.info.sessionString, key);
  upsertAccount(deps.db, {
    encryptedSessionString: envelope.ciphertext,
    keyFingerprint: envelope.keyFingerprint,
    phoneNumber: deps.info.phoneNumber,
    displayName: deps.info.displayName,
    username: deps.info.username,
    telegramUserId: deps.info.telegramUserId,
  });
  if (deps.reloadTelegramSession) {
    try {
      await deps.reloadTelegramSession();
    } catch {
      // Live-swap failed; row is saved, next restart picks it up.
    }
  }
}

function requireKeyConfigured(getEncryptionKey?: () => Buffer | null): void {
  const key = getEncryptionKey?.() ?? null;
  if (!key) {
    throw new AppError(
      412,
      'encryption_key_missing',
      'TG_SESSION_ENCRYPTION_KEY is not configured',
    );
  }
}

function requireStore(store?: LoginSessionStore): LoginSessionStore {
  if (!store) {
    throw new AppError(503, 'login_session_store_unavailable', 'login flow is not available');
  }
  return store;
}
