import { useQuery } from '@tanstack/react-query';
import { getSystemStatus } from '@/api/systemApi';

export const SYSTEM_STATUS_KEY = ['system', 'status'] as const;

export function useSystemStatus() {
  return useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: getSystemStatus,
    staleTime: 60_000,
    // Poll only while connecting so the SettingsPage banner clears without a manual nav.
    refetchInterval: (query) => (query.state.data?.telegram.state === 'connecting' ? 1500 : false),
  });
}
