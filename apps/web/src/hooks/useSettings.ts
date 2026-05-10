import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsDto, UpdateSettingsRequest } from '@tg-feed/shared';
import { getSettings, updateSettings } from '@/api/settingsApi';

export const SETTINGS_KEY = ['settings'] as const;

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation<SettingsDto, Error, UpdateSettingsRequest>({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
    },
  });
}
