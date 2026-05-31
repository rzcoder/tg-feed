import { useQuery } from '@tanstack/react-query';
import { getForwardLogRaw } from '@/api/forwardLogApi';

/**
 * Fetch the raw JSON snapshot for a single `forward_log` row. Deferred from
 * the list response on purpose — the payload averages ~3KB but can spike to
 * tens of KB for media-heavy messages, so we only pay the cost on click.
 *
 * Caches indefinitely (the row's raw_message is write-once) and pauses
 * itself when `id` is `null`/`undefined` so opening the JSON Sheet without
 * a selected entry doesn't fire a request.
 */
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
