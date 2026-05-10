import { useQuery } from '@tanstack/react-query';
import type { ForwardLogQuery } from '@tg-feed/shared';
import { listForwardLog } from '@/api/forwardLogApi';

export const FORWARD_LOG_KEY = ['forward-log'] as const;

export function useForwardLog(query: Partial<ForwardLogQuery> = {}) {
  return useQuery({
    queryKey: [...FORWARD_LOG_KEY, query],
    queryFn: () => listForwardLog(query),
    staleTime: Infinity,
  });
}
