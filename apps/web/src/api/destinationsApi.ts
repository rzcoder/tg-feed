import {
  createDestinationRequestSchema,
  destinationDtoSchema,
  destinationListResponseSchema,
  type CreateDestinationRequest,
  type DestinationDto,
  type DestinationListResponse,
  type UpdateDestinationRequest,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function listDestinations(): Promise<DestinationListResponse> {
  const res = await apiFetch<unknown>('/api/destinations');
  return destinationListResponseSchema.parse(res);
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
