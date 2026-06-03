// In-memory store for in-progress Telegram sign-ins, split across HTTP steps because gramjs's callback-based start() can't pause for UI prompts.
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
  // ownerToken binds the session to the calling web session so other tabs can't drive it; empty string (raw-paste/legacy) skips binding.
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
  // empty string disables owner binding
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
  if (typeof gc.unref === 'function') gc.unref();

  function generateSessionId(): string {
    return randomBytes(SESSION_ID_BYTES).toString('hex');
  }

  function assertOwner(pending: PendingLogin, ownerToken: string | undefined): void {
    if (pending.ownerToken && ownerToken && pending.ownerToken !== ownerToken) {
      throw new AppError(
        403,
        'login_session_owner_mismatch',
        'login session belongs to another tab',
      );
    }
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
    assertOwner(pending, ownerToken);
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
          // Refresh TTL and keep the client alive for the follow-up verifyPassword.
          pending.expiresAt = Date.now() + ttlMs;
          return { needsPassword: true };
        }
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
        // Wrong password keeps the session alive for retry; anything else tears it down.
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
      assertOwner(pending, ownerToken);
      sessions.delete(sessionId);
      await disconnectSilently(pending.client, logger);
    },

    async validateRaw(sessionString) {
      if (!sessionString || sessionString.length < 8) {
        throw new ValidationError('session string is empty or too short');
      }
      // StringSession throws on a missing version byte or truncated payload; surface as 400, not a generic 500.
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
  // gramjs types session.save() as void though StringSession returns the encoded string at runtime.
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
  // gramjs FloodWait surfaces the wait time as `seconds`.
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
