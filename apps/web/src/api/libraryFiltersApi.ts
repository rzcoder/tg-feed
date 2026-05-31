import {
  attachLibraryFilterRequestSchema,
  createLibraryFilterRequestSchema,
  libraryFilterDtoSchema,
  libraryFilterListResponseSchema,
  subscriptionDtoSchema,
  type CreateLibraryFilterRequest,
  type LibraryFilterDto,
  type LibraryFilterListResponse,
  type SubscriptionDto,
  type UpdateLibraryFilterRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listLibraryFilters(): Promise<LibraryFilterListResponse> {
  const res = await apiFetch<unknown>('/api/library-filters');
  return libraryFilterListResponseSchema.parse(res);
}

export async function createLibraryFilter(
  body: CreateLibraryFilterRequest,
): Promise<LibraryFilterDto> {
  const validated = createLibraryFilterRequestSchema.parse(body);
  const res = await apiFetch<unknown, typeof validated>('/api/library-filters', {
    method: 'POST',
    body: validated,
  });
  return libraryFilterDtoSchema.parse(res);
}

export async function updateLibraryFilter(
  id: number,
  body: UpdateLibraryFilterRequest,
): Promise<LibraryFilterDto> {
  const res = await apiFetch<unknown, UpdateLibraryFilterRequest>(`/api/library-filters/${id}`, {
    method: 'PATCH',
    body,
  });
  return libraryFilterDtoSchema.parse(res);
}

export async function deleteLibraryFilter(id: number): Promise<void> {
  await apiFetch<void>(`/api/library-filters/${id}`, { method: 'DELETE' });
}

export async function attachLibraryFilter(
  subscriptionId: number,
  libraryFilterId: number,
): Promise<SubscriptionDto> {
  const body = attachLibraryFilterRequestSchema.parse({ libraryFilterId });
  const res = await apiFetch<unknown, typeof body>(
    `/api/subscriptions/${subscriptionId}/library-filters`,
    { method: 'POST', body },
  );
  return subscriptionDtoSchema.parse(res);
}

export async function detachLibraryFilter(
  subscriptionId: number,
  libraryFilterId: number,
): Promise<void> {
  await apiFetch<void>(`/api/subscriptions/${subscriptionId}/library-filters/${libraryFilterId}`, {
    method: 'DELETE',
  });
}
