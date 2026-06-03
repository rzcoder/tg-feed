import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BotConfigInfo,
  ResolveBotAdminResponse,
  UpdateBotConfigRequest,
} from '@tg-feed/shared';
import {
  deleteBotConfig,
  getBotConfig,
  resolveBotAdmin,
  updateBotConfig,
} from '@/api/botConfigApi';

export const BOT_CONFIG_KEY = ['botConfig'] as const;

export function useBotConfig() {
  return useQuery({ queryKey: BOT_CONFIG_KEY, queryFn: getBotConfig, staleTime: 30_000 });
}

export function useUpdateBotConfig() {
  const qc = useQueryClient();
  return useMutation<BotConfigInfo, Error, UpdateBotConfigRequest>({
    mutationFn: updateBotConfig,
    // PUT returns the fresh masked view, so seed the cache directly instead of refetching.
    onSuccess: (data) => qc.setQueryData(BOT_CONFIG_KEY, data),
  });
}

export function useDeleteBotConfig() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: deleteBotConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: BOT_CONFIG_KEY }),
  });
}

export function useResolveBotAdmin() {
  return useMutation<ResolveBotAdminResponse, Error, string>({ mutationFn: resolveBotAdmin });
}

export type { BotConfigInfo };
