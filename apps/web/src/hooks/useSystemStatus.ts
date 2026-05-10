import { useQuery } from '@tanstack/react-query';
import { getSystemStatus } from '@/api/systemApi';

export const SYSTEM_STATUS_KEY = ['system', 'status'] as const;

export function useSystemStatus() {
  return useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: getSystemStatus,
    staleTime: 60_000,
  });
}
