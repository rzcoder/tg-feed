import { systemStatusResponseSchema, type SystemStatusResponse } from '@tg-feed/shared';
import { apiFetch } from './client';

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  const res = await apiFetch<unknown>('/api/system/status');
  return systemStatusResponseSchema.parse(res);
}
