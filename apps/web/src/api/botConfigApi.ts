import {
  botConfigDeleteResponseSchema,
  botConfigInfoSchema,
  resolveBotAdminRequestSchema,
  resolveBotAdminResponseSchema,
  type BotConfigDeleteResponse,
  type BotConfigInfo,
  type ResolveBotAdminResponse,
  type UpdateBotConfigRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function getBotConfig(): Promise<BotConfigInfo> {
  const res = await apiFetch<unknown>('/api/config/bot');
  return botConfigInfoSchema.parse(res);
}

export async function updateBotConfig(body: UpdateBotConfigRequest): Promise<BotConfigInfo> {
  const res = await apiFetch<unknown, UpdateBotConfigRequest>('/api/config/bot', {
    method: 'PUT',
    body,
  });
  return botConfigInfoSchema.parse(res);
}

export async function deleteBotConfig(): Promise<BotConfigDeleteResponse> {
  const res = await apiFetch<unknown>('/api/config/bot', { method: 'DELETE' });
  return botConfigDeleteResponseSchema.parse(res);
}

export async function resolveBotAdmin(query: string): Promise<ResolveBotAdminResponse> {
  const body = resolveBotAdminRequestSchema.parse({ query });
  const res = await apiFetch<unknown, typeof body>('/api/config/bot/resolve-admin', {
    method: 'POST',
    body,
  });
  return resolveBotAdminResponseSchema.parse(res);
}
