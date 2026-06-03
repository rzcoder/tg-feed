// useMe is the source of truth for "logged in". staleTime Infinity since cookie validity is stable per tab; a mid-session expiry is caught by the client.ts 401-interceptor.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, login, loginWithTelegram, logout } from '@/api/authApi';
import { UnauthorizedError } from '@/api/client';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: getMe,
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => login(password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export function useTelegramLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (initData: string) => loginWithTelegram(initData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      qc.clear();
    },
  });
}

export { UnauthorizedError };
