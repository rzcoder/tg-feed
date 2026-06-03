import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Never retry auth failures — the 401 interceptor will redirect.
          if (error instanceof Error && error.name === 'UnauthorizedError') return false;
          return failureCount < 2;
        },
        // Refetch on focus so a tab left open overnight isn't stale; SSE covers live subscription updates.
        refetchOnWindowFocus: true,
        staleTime: 5_000,
        gcTime: 10 * 60 * 1000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
