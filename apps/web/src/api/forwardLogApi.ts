import {
  forwardLogQuerySchema,
  forwardLogRawResponseSchema,
  forwardLogResponseSchema,
  type ForwardLogQuery,
  type ForwardLogRawResponse,
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

export async function getForwardLogRaw(id: number): Promise<ForwardLogRawResponse> {
  const res = await apiFetch<unknown>(`/api/forward-log/${id}/raw`);
  return forwardLogRawResponseSchema.parse(res);
}
