import {
  settingsDtoSchema,
  updateSettingsRequestSchema,
  type SettingsDto,
  type UpdateSettingsRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function getSettings(): Promise<SettingsDto> {
  const res = await apiFetch<unknown>('/api/settings');
  return settingsDtoSchema.parse(res);
}

export async function updateSettings(body: UpdateSettingsRequest): Promise<SettingsDto> {
  const validated = updateSettingsRequestSchema.parse(body);
  const res = await apiFetch<unknown, typeof validated>('/api/settings', {
    method: 'PUT',
    body: validated,
  });
  return settingsDtoSchema.parse(res);
}
