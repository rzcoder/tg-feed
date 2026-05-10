import { useQuery } from '@tanstack/react-query';
import { getSystemStatus } from '@/api/systemApi';

export const SYSTEM_STATUS_KEY = ['system', 'status'] as const;

export function useSystemStatus() {
  return useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: getSystemStatus,
    staleTime: 60_000,
    // Poll while Telegram is still bringing itself up so the SettingsPage
    // banner clears within a couple seconds of init finishing, instead of
    // waiting until the user navigates away and back. Stops polling once
    // the state lands on `connected` or `disconnected`.
    refetchInterval: (query) => (query.state.data?.telegram.state === 'connecting' ? 1500 : false),
  });
}
