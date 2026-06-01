import {
  createDestinationRequestSchema,
  destinationDtoSchema,
  destinationListResponseSchema,
  listForumTopicsRequestSchema,
  listForumTopicsResponseSchema,
  resolveDestinationRequestSchema,
  resolveDestinationResponseSchema,
  type CreateDestinationRequest,
  type DestinationDto,
  type DestinationListResponse,
  type ListForumTopicsResponse,
  type ResolveDestinationResponse,
  type UpdateDestinationRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listDestinations(): Promise<DestinationListResponse> {
  const res = await apiFetch<unknown>('/api/destinations');
  return destinationListResponseSchema.parse(res);
}

export async function resolveDestination(input: string): Promise<ResolveDestinationResponse> {
  const body = resolveDestinationRequestSchema.parse({ input });
  const res = await apiFetch<unknown, typeof body>('/api/destinations/resolve', {
    method: 'POST',
    body,
  });
  return resolveDestinationResponseSchema.parse(res);
}

export async function createDestination(body: CreateDestinationRequest): Promise<DestinationDto> {
  const validated = createDestinationRequestSchema.parse(body);
  const res = await apiFetch<unknown, typeof validated>('/api/destinations', {
    method: 'POST',
    body: validated,
  });
  return destinationDtoSchema.parse(res);
}

export async function updateDestination(
  id: number,
  body: UpdateDestinationRequest,
): Promise<DestinationDto> {
  const res = await apiFetch<unknown, UpdateDestinationRequest>(`/api/destinations/${id}`, {
    method: 'PATCH',
    body,
  });
  return destinationDtoSchema.parse(res);
}

export async function deleteDestination(id: number): Promise<void> {
  await apiFetch<void>(`/api/destinations/${id}`, { method: 'DELETE' });
}

export async function listForumTopics(chatId: string): Promise<ListForumTopicsResponse> {
  const body = listForumTopicsRequestSchema.parse({ chatId });
  const res = await apiFetch<unknown, typeof body>('/api/destinations/topics', {
    method: 'POST',
    body,
  });
  return listForumTopicsResponseSchema.parse(res);
}
