import { useQuery } from '@tanstack/react-query';
import { getForwardLogRaw } from '@/api/forwardLogApi';

// Deferred raw-JSON fetch (kept off the list to avoid tens of KB/row); caches forever as raw_message is write-once, pauses while id is null.
export function useForwardLogRaw(id: number | null | undefined) {
  return useQuery({
    queryKey: ['forward-log', id, 'raw'] as const,
    queryFn: () => {
      if (id == null) throw new Error('useForwardLogRaw called without an id');
      return getForwardLogRaw(id);
    },
    enabled: id != null,
    staleTime: Infinity,
  });
}
