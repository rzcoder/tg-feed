import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDestination,
  deleteDestination,
  listDestinations,
  listForumTopics,
  resolveDestination,
  updateDestination,
} from '@/api/destinationsApi';
import type {
  CreateDestinationRequest,
  DestinationDto,
  ListForumTopicsResponse,
  ResolveDestinationResponse,
  UpdateDestinationRequest,
} from '@tg-feed/shared';

export const DESTINATIONS_KEY = ['destinations'] as const;

export function useDestinations() {
  return useQuery({
    queryKey: DESTINATIONS_KEY,
    queryFn: listDestinations,
    select: (res) => res.items,
  });
}

export function useCreateDestination() {
  const qc = useQueryClient();
  return useMutation<DestinationDto, Error, CreateDestinationRequest>({
    mutationFn: createDestination,
    onSuccess: () => qc.invalidateQueries({ queryKey: DESTINATIONS_KEY }),
  });
}

export function useUpdateDestination() {
  const qc = useQueryClient();
  return useMutation<DestinationDto, Error, { id: number; body: UpdateDestinationRequest }>({
    mutationFn: ({ id, body }) => updateDestination(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: DESTINATIONS_KEY }),
  });
}

export function useDeleteDestination() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteDestination,
    onSuccess: () => qc.invalidateQueries({ queryKey: DESTINATIONS_KEY }),
  });
}

export function useResolveDestination() {
  return useMutation<ResolveDestinationResponse, Error, string>({
    mutationFn: resolveDestination,
  });
}

// Pass enabled=true only for confirmed forum chats, so non-forum picks never fetch.
export function useForumTopics(chatId: string | null, enabled: boolean) {
  return useQuery<ListForumTopicsResponse>({
    queryKey: ['forum-topics', chatId],
    queryFn: () => listForumTopics(chatId!),
    enabled: enabled && !!chatId,
    staleTime: 60_000,
  });
}
