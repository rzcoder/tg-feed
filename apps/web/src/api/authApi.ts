import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  telegramAuthRequestSchema,
  type LoginResponse,
  type MeResponse,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function login(password: string): Promise<LoginResponse> {
  const body = loginRequestSchema.parse({ password });
  const res = await apiFetch<unknown, typeof body>('/api/auth/login', {
    method: 'POST',
    body,
    silent401: true,
  });
  return loginResponseSchema.parse(res);
}

/**
 * Sign in with a Telegram Mini App `initData` payload. The server verifies
 * its HMAC against the bot token and checks the admin allowlist. `silent401`
 * keeps a rejection from triggering the global redirect — the LoginPage falls
 * back to the password form instead.
 */
export async function loginWithTelegram(initData: string): Promise<LoginResponse> {
  const body = telegramAuthRequestSchema.parse({ initData });
  const res = await apiFetch<unknown, typeof body>('/api/auth/telegram', {
    method: 'POST',
    body,
    silent401: true,
  });
  return loginResponseSchema.parse(res);
}

export async function logout(): Promise<void> {
  await apiFetch<unknown>('/api/auth/logout', {
    method: 'POST',
    silent401: true,
  });
}

export async function getMe(): Promise<MeResponse> {
  const res = await apiFetch<unknown>('/api/me', { silent401: true });
  return meResponseSchema.parse(res);
}
