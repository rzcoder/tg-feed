import {
  forwardLogQuerySchema,
  forwardLogResponseSchema,
  type ForwardLogQuery,
  type ForwardLogResponse,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listForwardLog(
  query: Partial<ForwardLogQuery> = {},
): Promise<ForwardLogResponse> {
  const parsed = forwardLogQuerySchema.parse(query);
  const params = new URLSearchParams();
  params.set('limit', String(parsed.limit));
  params.set('offset', String(parsed.offset));
  const res = await apiFetch<unknown>(`/api/forward-log?${params}`);
  return forwardLogResponseSchema.parse(res);
}
