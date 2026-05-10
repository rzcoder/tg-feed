import {
  createSubscriptionRequestSchema,
  resolveSubscriptionRequestSchema,
  resolveSubscriptionResponseSchema,
  subscriptionDtoSchema,
  subscriptionListResponseSchema,
  type CreateSubscriptionRequest,
  type ResolveSubscriptionResponse,
  type SubscriptionDto,
  type SubscriptionListResponse,
  type UpdateSubscriptionRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listSubscriptions(): Promise<SubscriptionListResponse> {
  const res = await apiFetch<unknown>('/api/subscriptions');
  return subscriptionListResponseSchema.parse(res);
}

export async function resolveSubscription(input: string): Promise<ResolveSubscriptionResponse> {
  const body = resolveSubscriptionRequestSchema.parse({ input });
  const res = await apiFetch<unknown, typeof body>('/api/subscriptions/resolve', {
    method: 'POST',
    body,
  });
  return resolveSubscriptionResponseSchema.parse(res);
}

export async function createSubscription(
  body: CreateSubscriptionRequest,
): Promise<SubscriptionDto> {
  const validated = createSubscriptionRequestSchema.parse(body);
  const res = await apiFetch<unknown, typeof validated>('/api/subscriptions', {
    method: 'POST',
    body: validated,
  });
  return subscriptionDtoSchema.parse(res);
}

export async function updateSubscription(
  id: number,
  body: UpdateSubscriptionRequest,
): Promise<SubscriptionDto> {
  const res = await apiFetch<unknown, UpdateSubscriptionRequest>(`/api/subscriptions/${id}`, {
    method: 'PATCH',
    body,
  });
  return subscriptionDtoSchema.parse(res);
}

export async function deleteSubscription(id: number): Promise<void> {
  await apiFetch<void>(`/api/subscriptions/${id}`, { method: 'DELETE' });
}
