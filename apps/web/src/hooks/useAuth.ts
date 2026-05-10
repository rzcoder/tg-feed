/**
 * Auth hooks.
 *
 * `useMe` is the source of truth for "is the user logged in". It runs once
 * at app boot via `RequireAuth`; mutations invalidate it after login/logout.
 * staleTime is Infinity because cookie validity doesn't change while the
 * tab is open — if it expires mid-session, the api/client.ts 401-interceptor
 * forces a navigate to /login anyway.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout } from '@/api/authApi';
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
