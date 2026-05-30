/**
 * In-memory store for in-progress Telegram sign-ins from the Settings page.
 *
 * gramjs's `client.start()` uses callbacks (phoneNumber/phoneCode/password
 * resolved synchronously inside one promise) which fights HTTP step
 * boundaries — we need to break the flow across multiple requests so the
 * UI can prompt the user, get the code, then return for the next step.
 * The lower-level `Api.auth.SendCode` / `Api.auth.SignIn` / `CheckPassword`
 * triplet maps onto three HTTP calls cleanly.
 *
 * Each pending login holds a temp `TelegramClient` (with an empty
 * `StringSession`) that connects on `start()` and lives until either
 * `verifyCode` / `verifyPassword` / `validateRaw` finalize, `cancel` is
 * called, or the TTL GC sweeps it. The session string is only saved
 * after the final auth.* RPC succeeds.
 */
import { randomBytes } from 'node:crypto';
import { Api, TelegramClient } from 'telegram';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { AppError, ValidationError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export interface LoginAccountInfo {
  sessionString: string;
  phoneNumber: string | null;
  displayName: string | null;
  username: string | null;
  telegramUserId: string | null;
}

export interface VerifyCodeNeedsPassword {
  needsPassword: true;
}

export interface LoginCompleted {
  done: true;
  account: LoginAccountInfo;
}

export interface LoginSessionStore {
  /**
   * Begin a phone-code sign-in. `ownerToken` ties this session to the
   * calling web session so other authed tabs (or anyone who guesses a
   * sessionId) can't drive someone else's in-progress login. Defaults to
   * an empty string for raw-paste / legacy callers — those skip binding
   * because they don't need to cross HTTP boundaries.
   */
  start(phoneNumber: string, ownerToken?: string): Promise<{ sessionId: string }>;
  verifyCode(
    sessionId: string,
    code: string,
    ownerToken?: string,
  ): Promise<LoginCompleted | VerifyCodeNeedsPassword>;
  verifyPassword(sessionId: string, password: string, ownerToken?: string): Promise<LoginCompleted>;
  cancel(sessionId: string, ownerToken?: string): Promise<void>;
  validateRaw(sessionString: string): Promise<LoginAccountInfo>;
  shutdown(): Promise<void>;
}

export interface CreateLoginSessionStoreDeps {
  apiId: number;
  apiHash: string;
  logger: Logger;
  ttlMs?: number;
}

interface PendingLogin {
  client: TelegramClient;
  phoneNumber: string;
  phoneCodeHash: string;
  expiresAt: number;
  /**
   * Web-session token (the cookie value) of the caller who created this
   * login session. Empty string means "no binding" (legacy / raw-paste).
   * `verifyCode`/`verifyPassword`/`cancel` reject if the caller's token
   * doesn't match — keeps a second authed tab from hijacking the flow.
   */
  ownerToken: string;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;
const SESSION_ID_BYTES = 16;
const CONNECTION_RETRIES = 3;

export function createLoginSessionStore(deps: CreateLoginSessionStoreDeps): LoginSessionStore {
  const { apiId, apiHash, logger } = deps;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const sessions = new Map<string, PendingLogin>();

  const gc = setInterval(() => {
    const now = Date.now();
    for (const [id, pending] of sessions) {
      if (pending.expiresAt <= now) {
        sessions.delete(id);
        void disconnectSilently(pending.client, logger).catch(() => {});
      }
    }
  }, GC_INTERVAL_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof gc.unref === 'function') gc.unref();

  function generateSessionId(): string {
    return randomBytes(SESSION_ID_BYTES).toString('hex');
  }

  function takeSession(sessionId: string, ownerToken: string | undefined): PendingLogin {
    const pending = sessions.get(sessionId);
    if (!pending) {
      throw new AppError(410, 'login_session_expired', 'login session not found or expired');
    }
    if (pending.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      void disconnectSilently(pending.client, logger);
      throw new AppError(410, 'login_session_expired', 'login session expired');
    }
    // Owner-binding check: skip when either side has no token (raw-paste /
    // legacy path), enforce strictly when both sides have one. Using `!==`
    // is safe — opaque random tokens (random.bytes) don't admit a useful
    // timing attack at HTTP-request granularity.
    if (pending.ownerToken && ownerToken && pending.ownerToken !== ownerToken) {
      throw new AppError(
        403,
        'login_session_owner_mismatch',
        'login session belongs to another tab',
      );
    }
    return pending;
  }

  function dropSession(sessionId: string): PendingLogin | undefined {
    const pending = sessions.get(sessionId);
    if (pending) sessions.delete(sessionId);
    return pending;
  }

  return {
    async start(phoneNumber, ownerToken = '') {
      const trimmed = phoneNumber.trim();
      if (!/^\+?\d{6,20}$/.test(trimmed)) {
        throw new ValidationError('invalid phone number');
      }
      const client = newTempClient(apiId, apiHash);
      try {
        await client.connect();
        const result = (await client.invoke(
          new Api.auth.SendCode({
            phoneNumber: trimmed,
            apiId,
            apiHash,
            settings: new Api.CodeSettings({}),
          }),
        )) as { phoneCodeHash?: string };
        const phoneCodeHash = result?.phoneCodeHash;
        if (!phoneCodeHash) {
          throw new AppError(
            502,
            'telegram_send_code_failed',
            'Telegram did not return a code hash',
          );
        }
        const sessionId = generateSessionId();
        sessions.set(sessionId, {
          client,
          phoneNumber: trimmed,
          phoneCodeHash,
          expiresAt: Date.now() + ttlMs,
          ownerToken,
        });
        return { sessionId };
      } catch (err) {
        await disconnectSilently(client, logger);
        throw mapGramError(err);
      }
    },

    async verifyCode(sessionId, code, ownerToken) {
      const pending = takeSession(sessionId, ownerToken);
      const trimmedCode = code.trim();
      if (!/^\d{4,8}$/.test(trimmedCode)) {
        throw new ValidationError('invalid login code');
      }
      try {
        await pending.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: pending.phoneNumber,
            phoneCodeHash: pending.phoneCodeHash,
            phoneCode: trimmedCode,
          }),
        );
        const account = await finalize(pending);
        dropSession(sessionId);
        await disconnectSilently(pending.client, logger);
        return { done: true, account };
      } catch (err) {
        if (isPasswordNeeded(err)) {
          // Keep the temp client alive for the follow-up `verifyPassword` call.
          // Refresh the TTL window so the user has time to enter the 2FA password.
          pending.expiresAt = Date.now() + ttlMs;
          return { needsPassword: true };
        }
        // Any other error terminates this attempt — drop the temp client so it
        // doesn't leak. The caller can `start` again.
        dropSession(sessionId);
        await disconnectSilently(pending.client, logger);
        throw mapGramError(err);
      }
    },

    async verifyPassword(sessionId, password, ownerToken) {
      const pending = takeSession(sessionId, ownerToken);
      try {
        const passwordSrp = await pending.client.invoke(new Api.account.GetPassword());
        const check = await computeCheck(passwordSrp, password);
        await pending.client.invoke(new Api.auth.CheckPassword({ password: check }));
        const account = await finalize(pending);
        dropSession(sessionId);
        await disconnectSilently(pending.client, logger);
        return { done: true, account };
      } catch (err) {
        // Wrong password → keep the session alive so the user can retry; any
        // other error tears it down.
        if (isPasswordWrong(err)) {
          pending.expiresAt = Date.now() + ttlMs;
          throw new AppError(401, 'wrong_2fa_password', 'incorrect 2FA password');
        }
        dropSession(sessionId);
        await disconnectSilently(pending.client, logger);
        throw mapGramError(err);
      }
    },

    async cancel(sessionId, ownerToken) {
      const pending = sessions.get(sessionId);
      if (!pending) return;
      // Owner check — if the binding is present on both sides, enforce.
      // We tolerate missing tokens on either side (raw-paste / legacy) so
      // an operator cleaning up after a server restart can still cancel.
      if (pending.ownerToken && ownerToken && pending.ownerToken !== ownerToken) {
        throw new AppError(
          403,
          'login_session_owner_mismatch',
          'login session belongs to another tab',
        );
      }
      sessions.delete(sessionId);
      await disconnectSilently(pending.client, logger);
    },

    async validateRaw(sessionString) {
      if (!sessionString || sessionString.length < 8) {
        throw new ValidationError('session string is empty or too short');
      }
      // gramjs's `StringSession` parser throws `Error("Not a valid string")`
      // when the input doesn't start with the version byte, and its
      // `BinaryReader` can throw on truncated payloads. Both cases need to
      // surface as a 400 with a clear code instead of escaping the route as
      // a generic 500.
      let session: StringSession;
      try {
        session = new StringSession(sessionString);
      } catch (err) {
        throw new AppError(
          400,
          'invalid_session_string',
          `session string is malformed${err instanceof Error ? `: ${err.message}` : ''}`,
        );
      }
      let client: TelegramClient | undefined;
      try {
        client = new TelegramClient(session, apiId, apiHash, {
          connectionRetries: CONNECTION_RETRIES,
        });
        client.setLogLevel(LogLevel.WARN);
        await client.connect();
        const me = (await client.getMe()) as Api.User | null;
        if (!me) {
          throw new AppError(400, 'invalid_session_string', 'session is not authorized');
        }
        const savedRaw = client.session.save() as unknown;
        const saved =
          typeof savedRaw === 'string' && savedRaw.length > 0 ? savedRaw : sessionString;
        return {
          sessionString: saved,
          phoneNumber: me.phone ? `+${me.phone}` : null,
          displayName: buildDisplayName(me),
          username: me.username ?? null,
          telegramUserId: me.id ? String(me.id) : null,
        };
      } catch (err) {
        throw mapGramError(err);
      } finally {
        if (client) await disconnectSilently(client, logger);
      }
    },

    async shutdown() {
      clearInterval(gc);
      const all = Array.from(sessions.values());
      sessions.clear();
      await Promise.all(all.map((p) => disconnectSilently(p.client, logger)));
    },
  };
}

function newTempClient(apiId: number, apiHash: string): TelegramClient {
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
  client.setLogLevel(LogLevel.WARN);
  return client;
}

async function finalize(pending: PendingLogin): Promise<LoginAccountInfo> {
  const me = (await pending.client.getMe()) as Api.User;
  // gramjs types `session.save()` as `void` even though `StringSession`
  // returns the encoded string at runtime. Cast through `unknown` to avoid
  // the strict-overlap warning.
  const sessionString = pending.client.session.save() as unknown as string;
  if (typeof sessionString !== 'string' || sessionString.length === 0) {
    throw new AppError(502, 'session_save_failed', 'failed to mint Telegram session');
  }
  return {
    sessionString,
    phoneNumber: me?.phone ? `+${me.phone}` : (pending.phoneNumber ?? null),
    displayName: buildDisplayName(me),
    username: me?.username ?? null,
    telegramUserId: me?.id ? String(me.id) : null,
  };
}

function buildDisplayName(me: Api.User | undefined): string | null {
  if (!me) return null;
  const parts = [me.firstName, me.lastName].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  return parts.join(' ');
}

async function disconnectSilently(client: TelegramClient, logger: Logger): Promise<void> {
  try {
    await client.disconnect();
    await client.destroy();
  } catch (err) {
    logger.debug({ err }, 'temp telegram client teardown failed');
  }
}

function isPasswordNeeded(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const message = (err as { errorMessage?: string }).errorMessage;
  if (typeof message === 'string' && message.includes('SESSION_PASSWORD_NEEDED')) return true;
  return (err as { className?: string }).className === 'SessionPasswordNeededError';
}

function isPasswordWrong(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const message = (err as { errorMessage?: string }).errorMessage;
  return typeof message === 'string' && message.includes('PASSWORD_HASH_INVALID');
}

function mapGramError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // FloodWait — gramjs surfaces the wait time as `seconds`.
  const seconds = (err as { seconds?: unknown }).seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return new AppError(
      429,
      'telegram_flood_wait',
      `Telegram is rate-limiting; retry in ${seconds} seconds`,
    );
  }
  const errorMessage = (err as { errorMessage?: unknown }).errorMessage;
  if (typeof errorMessage === 'string') {
    if (errorMessage.includes('PHONE_CODE_INVALID') || errorMessage.includes('PHONE_CODE_EMPTY')) {
      return new AppError(400, 'invalid_login_code', 'incorrect login code');
    }
    if (errorMessage.includes('PHONE_CODE_EXPIRED')) {
      return new AppError(410, 'login_code_expired', 'login code expired; restart the flow');
    }
    if (errorMessage.includes('PHONE_NUMBER_INVALID')) {
      return new AppError(400, 'invalid_phone_number', 'invalid phone number');
    }
    if (errorMessage.includes('PHONE_NUMBER_BANNED')) {
      return new AppError(400, 'phone_banned', 'this phone number is banned by Telegram');
    }
    if (
      errorMessage.includes('AUTH_KEY_UNREGISTERED') ||
      errorMessage.includes('AUTH_KEY_INVALID')
    ) {
      return new AppError(400, 'invalid_session_string', 'session string is not authorized');
    }
    return new AppError(502, 'telegram_error', errorMessage);
  }
  if (err instanceof Error) {
    return new AppError(502, 'telegram_error', err.message);
  }
  return new AppError(502, 'telegram_error', 'unknown Telegram error');
}
