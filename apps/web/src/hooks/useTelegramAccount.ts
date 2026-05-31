import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TelegramAccountInfo,
  TelegramLoginCancelRequest,
  TelegramLoginCancelResponse,
  TelegramLoginCompleted,
  TelegramLoginPasswordRequest,
  TelegramLoginRawRequest,
  TelegramLoginStartRequest,
  TelegramLoginStartResponse,
  TelegramLoginVerifyRequest,
  TelegramLoginVerifyResponse,
} from '@tg-feed/shared';
import {
  cancelTelegramLogin,
  deleteTelegramAccount,
  getTelegramAccount,
  loginTelegramRaw,
  startTelegramLogin,
  verifyTelegramLoginCode,
  verifyTelegramLoginPassword,
} from '@/api/telegramAccountApi';
import { SYSTEM_STATUS_KEY } from './useSystemStatus';

export const TELEGRAM_ACCOUNT_KEY = ['telegramAccount'] as const;

export function useTelegramAccount() {
  return useQuery({
    queryKey: TELEGRAM_ACCOUNT_KEY,
    queryFn: getTelegramAccount,
    staleTime: 30_000,
  });
}

function useInvalidateAccount() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: TELEGRAM_ACCOUNT_KEY });
    qc.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
  };
}

export function useStartTelegramLogin() {
  return useMutation<TelegramLoginStartResponse, Error, TelegramLoginStartRequest>({
    mutationFn: startTelegramLogin,
  });
}

export function useVerifyTelegramLoginCode() {
  const invalidate = useInvalidateAccount();
  return useMutation<TelegramLoginVerifyResponse, Error, TelegramLoginVerifyRequest>({
    mutationFn: verifyTelegramLoginCode,
    onSuccess: (res) => {
      if (res.done) invalidate();
    },
  });
}

export function useVerifyTelegramLoginPassword() {
  const invalidate = useInvalidateAccount();
  return useMutation<TelegramLoginCompleted, Error, TelegramLoginPasswordRequest>({
    mutationFn: verifyTelegramLoginPassword,
    onSuccess: () => invalidate(),
  });
}

export function useLoginTelegramRaw() {
  const invalidate = useInvalidateAccount();
  return useMutation<TelegramLoginCompleted, Error, TelegramLoginRawRequest>({
    mutationFn: loginTelegramRaw,
    onSuccess: () => invalidate(),
  });
}

export function useCancelTelegramLogin() {
  return useMutation<TelegramLoginCancelResponse, Error, TelegramLoginCancelRequest>({
    mutationFn: cancelTelegramLogin,
  });
}

export function useDeleteTelegramAccount() {
  const invalidate = useInvalidateAccount();
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: deleteTelegramAccount,
    onSuccess: () => invalidate(),
  });
}

export type { TelegramAccountInfo };
