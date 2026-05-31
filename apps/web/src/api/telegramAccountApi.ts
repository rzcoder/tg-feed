import {
  telegramAccountInfoSchema,
  telegramLoginCancelResponseSchema,
  telegramLoginPasswordResponseSchema,
  telegramLoginRawResponseSchema,
  telegramLoginStartResponseSchema,
  telegramLoginVerifyResponseSchema,
  type TelegramAccountInfo,
  type TelegramLoginCancelRequest,
  type TelegramLoginCancelResponse,
  type TelegramLoginCompleted,
  type TelegramLoginPasswordRequest,
  type TelegramLoginRawRequest,
  type TelegramLoginStartRequest,
  type TelegramLoginStartResponse,
  type TelegramLoginVerifyRequest,
  type TelegramLoginVerifyResponse,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function getTelegramAccount(): Promise<TelegramAccountInfo> {
  const res = await apiFetch<unknown>('/api/tg/account');
  return telegramAccountInfoSchema.parse(res);
}

export async function startTelegramLogin(
  body: TelegramLoginStartRequest,
): Promise<TelegramLoginStartResponse> {
  const res = await apiFetch<unknown, TelegramLoginStartRequest>('/api/tg/login/start', {
    method: 'POST',
    body,
  });
  return telegramLoginStartResponseSchema.parse(res);
}

export async function verifyTelegramLoginCode(
  body: TelegramLoginVerifyRequest,
): Promise<TelegramLoginVerifyResponse> {
  const res = await apiFetch<unknown, TelegramLoginVerifyRequest>('/api/tg/login/verify', {
    method: 'POST',
    body,
  });
  return telegramLoginVerifyResponseSchema.parse(res);
}

export async function verifyTelegramLoginPassword(
  body: TelegramLoginPasswordRequest,
): Promise<TelegramLoginCompleted> {
  const res = await apiFetch<unknown, TelegramLoginPasswordRequest>('/api/tg/login/password', {
    method: 'POST',
    body,
  });
  return telegramLoginPasswordResponseSchema.parse(res);
}

export async function loginTelegramRaw(
  body: TelegramLoginRawRequest,
): Promise<TelegramLoginCompleted> {
  const res = await apiFetch<unknown, TelegramLoginRawRequest>('/api/tg/login/raw', {
    method: 'POST',
    body,
  });
  return telegramLoginRawResponseSchema.parse(res);
}

export async function cancelTelegramLogin(
  body: TelegramLoginCancelRequest,
): Promise<TelegramLoginCancelResponse> {
  const res = await apiFetch<unknown, TelegramLoginCancelRequest>('/api/tg/login/cancel', {
    method: 'POST',
    body,
  });
  return telegramLoginCancelResponseSchema.parse(res);
}

export async function deleteTelegramAccount(): Promise<{ ok: true }> {
  await apiFetch<unknown>('/api/tg/account', { method: 'DELETE' });
  return { ok: true };
}
