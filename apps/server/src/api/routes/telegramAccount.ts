/**
 * Telegram account routes — settings-page sign-in / sign-out.
 *
 * GET    /api/tg/account              → current state, source, key status
 * POST   /api/tg/login/start          → send code to a phone, returns sessionId
 * POST   /api/tg/login/verify         → verify code; may signal needsPassword
 * POST   /api/tg/login/password       → 2FA password
 * POST   /api/tg/login/raw            → paste a raw session string (validated)
 * POST   /api/tg/login/cancel         → drop an in-progress login
 * DELETE /api/tg/account              → remove the DB row, env fallback resumes
 *
 * "Save" branches refuse with 412 unless `TG_SESSION_ENCRYPTION_KEY` is
 * configured. The encrypted blob is written to `telegram_account` (single
 * row, id=1) and `reloadTelegramSession()` is called so the gramjs runtime
 * picks up the new credentials without a restart.
 *
 * Each in-progress login session is bound to the caller's web-session cookie
 * token via `readSessionToken(request)`; verify/password/cancel reject if a
 * second authed tab tries to drive someone else's flow. The phone-code and
 * password endpoints are rate-limited per IP — brute-forcing a 5-digit
 * Telegram code via this surface would shadow-ban the operator's phone.
 */
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
  /** Returns the configured 32-byte key, or null when unset. */
  getEncryptionKey?: () => Buffer | null;
  /** In-memory store for in-progress sign-ins. */
  loginSessionStore?: LoginSessionStore;
  /** Triggers the live-swap so a freshly-saved session takes effect immediately. */
  reloadTelegramSession?: () => Promise<void>;
  /** Lifecycle of the gramjs subsystem (used to compute `present`). */
  getTelegramStatus: () => TelegramStatus;
  /**
   * Profile-photo fetcher over the live userbot. Used to fetch the account's
   * own avatar ("me"); absent when no client is up (tests / disconnected).
   */
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
}

// Avatar cache TTL — long enough to avoid re-downloading on every settings
// poll, short enough that a changed/swapped photo or a transient miss is
// picked up without a sign-out or restart.
const AVATAR_TTL_MS = 10 * 60_000;
const AVATAR_FETCH_TIMEOUT_MS = 2500;

/** Resolves to null after the timeout so a stalled download can't hang the route. */
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

  // The userbot's own avatar, downloaded lazily and cached with a short TTL so
  // a transient miss or a changed/swapped photo is eventually picked up
  // without re-downloading on every poll. Cleared outright on sign-in / out.
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
      // Don't let a hung gramjs download block this frequently-polled route.
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
      // Telegram throttles SendCode aggressively per phone number; cap our own
      // call rate to avoid getting the operator's phone number shadow-banned
      // when the UI fires repeated start requests.
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
      // Brute-forcing the SMS code via this surface would shadow-ban the
      // phone — Telegram counts attempts per phone+app, not per IP. Stay
      // well under the limit; legitimate users only need a handful of tries.
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
      // Same reasoning as `/verify` — 2FA password brute-force is upstream-
      // rate-limited but the operator pays the bill.
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
      // Live-swap to env (or degraded) — failures are logged inside
      // `reloadTelegramSession` and don't block the user. The DB row is
      // already gone; next boot will pick up the env fallback.
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
  // A row whose fingerprint doesn't match the current key (or no key set)
  // is "stale" — the resolver fell through to env. Report the mismatch
  // separately so the UI can prompt the operator without claiming the row
  // is the live account.
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
      // Live-swap failed; the DB row is still saved. The next process restart
      // picks it up. The caller rebuilds the account info regardless so the UI
      // can confirm the save.
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
