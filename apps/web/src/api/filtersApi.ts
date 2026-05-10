import {
  createSubscriptionFilterRequestSchema,
  filterRuleCatalogResponseSchema,
  subscriptionFilterDtoSchema,
  subscriptionFilterListResponseSchema,
  type CreateSubscriptionFilterRequest,
  type FilterRuleCatalogResponse,
  type SubscriptionFilterDto,
  type SubscriptionFilterListResponse,
  type UpdateSubscriptionFilterRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listFilterCatalog(): Promise<FilterRuleCatalogResponse> {
  const res = await apiFetch<unknown>('/api/filters/catalog');
  return filterRuleCatalogResponseSchema.parse(res);
}

export async function listSubscriptionFilters(
  subscriptionId: number,
): Promise<SubscriptionFilterListResponse> {
  const res = await apiFetch<unknown>(`/api/subscriptions/${subscriptionId}/filters`);
  return subscriptionFilterListResponseSchema.parse(res);
}

export async function createSubscriptionFilter(
  subscriptionId: number,
  body: CreateSubscriptionFilterRequest,
): Promise<SubscriptionFilterDto> {
  const validated = createSubscriptionFilterRequestSchema.parse(body);
  const res = await apiFetch<unknown, typeof validated>(
    `/api/subscriptions/${subscriptionId}/filters`,
    { method: 'POST', body: validated },
  );
  return subscriptionFilterDtoSchema.parse(res);
}

export async function updateSubscriptionFilter(
  subscriptionId: number,
  filterId: number,
  body: UpdateSubscriptionFilterRequest,
): Promise<SubscriptionFilterDto> {
  const res = await apiFetch<unknown, UpdateSubscriptionFilterRequest>(
    `/api/subscriptions/${subscriptionId}/filters/${filterId}`,
    { method: 'PATCH', body },
  );
  return subscriptionFilterDtoSchema.parse(res);
}

export async function deleteSubscriptionFilter(
  subscriptionId: number,
  filterId: number,
): Promise<void> {
  await apiFetch<void>(`/api/subscriptions/${subscriptionId}/filters/${filterId}`, {
    method: 'DELETE',
  });
}
