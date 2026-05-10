import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSubscriptionFilter,
  deleteSubscriptionFilter,
  listFilterCatalog,
  listSubscriptionFilters,
  updateSubscriptionFilter,
} from '@/api/filtersApi';
import {
  attachLibraryFilter,
  createLibraryFilter,
  deleteLibraryFilter,
  detachLibraryFilter,
  listLibraryFilters,
  updateLibraryFilter,
} from '@/api/libraryFiltersApi';
import type {
  CreateLibraryFilterRequest,
  CreateSubscriptionFilterRequest,
  LibraryFilterDto,
  SubscriptionDto,
  SubscriptionFilterDto,
  UpdateLibraryFilterRequest,
  UpdateSubscriptionFilterRequest,
} from '@tg-feed/shared';
import { SUBSCRIPTIONS_KEY } from './useSubscriptions';

export const FILTER_CATALOG_KEY = ['filter-catalog'] as const;
export const LIBRARY_FILTERS_KEY = ['library-filters'] as const;
export const subscriptionFiltersKey = (id: number) => ['subscription-filters', id] as const;

export function useFilterCatalog() {
  return useQuery({
    queryKey: FILTER_CATALOG_KEY,
    queryFn: listFilterCatalog,
    staleTime: Infinity,
    select: (res) => res.items,
  });
}

export function useSubscriptionFilters(subscriptionId: number | null) {
  return useQuery({
    queryKey: subscriptionId
      ? subscriptionFiltersKey(subscriptionId)
      : ['subscription-filters', 'idle'],
    queryFn: () => listSubscriptionFilters(subscriptionId!),
    enabled: subscriptionId !== null,
    select: (res) => res.items,
  });
}

export function useCreateSubscriptionFilter() {
  const qc = useQueryClient();
  return useMutation<
    SubscriptionFilterDto,
    Error,
    { subscriptionId: number; body: CreateSubscriptionFilterRequest }
  >({
    mutationFn: ({ subscriptionId, body }) => createSubscriptionFilter(subscriptionId, body),
    onSuccess: (_, { subscriptionId }) => {
      qc.invalidateQueries({ queryKey: subscriptionFiltersKey(subscriptionId) });
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }); // filterCount changed
    },
  });
}

export function useUpdateSubscriptionFilter() {
  const qc = useQueryClient();
  return useMutation<
    SubscriptionFilterDto,
    Error,
    { subscriptionId: number; filterId: number; body: UpdateSubscriptionFilterRequest }
  >({
    mutationFn: ({ subscriptionId, filterId, body }) =>
      updateSubscriptionFilter(subscriptionId, filterId, body),
    onSuccess: (_, { subscriptionId }) => {
      qc.invalidateQueries({ queryKey: subscriptionFiltersKey(subscriptionId) });
    },
  });
}

export function useDeleteSubscriptionFilter() {
  const qc = useQueryClient();
  return useMutation<void, Error, { subscriptionId: number; filterId: number }>({
    mutationFn: ({ subscriptionId, filterId }) =>
      deleteSubscriptionFilter(subscriptionId, filterId),
    onSuccess: (_, { subscriptionId }) => {
      qc.invalidateQueries({ queryKey: subscriptionFiltersKey(subscriptionId) });
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });
}

// --- Library filters ---

export function useLibraryFilters() {
  return useQuery({
    queryKey: LIBRARY_FILTERS_KEY,
    queryFn: listLibraryFilters,
    select: (res) => res.items,
  });
}

export function useCreateLibraryFilter() {
  const qc = useQueryClient();
  return useMutation<LibraryFilterDto, Error, CreateLibraryFilterRequest>({
    mutationFn: createLibraryFilter,
    onSuccess: () => qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY }),
  });
}

export function useUpdateLibraryFilter() {
  const qc = useQueryClient();
  return useMutation<LibraryFilterDto, Error, { id: number; body: UpdateLibraryFilterRequest }>({
    mutationFn: ({ id, body }) => updateLibraryFilter(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY }),
  });
}

export function useDeleteLibraryFilter() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteLibraryFilter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY });
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });
}

export function useAttachLibraryFilter() {
  const qc = useQueryClient();
  return useMutation<SubscriptionDto, Error, { subscriptionId: number; libraryFilterId: number }>({
    mutationFn: ({ subscriptionId, libraryFilterId }) =>
      attachLibraryFilter(subscriptionId, libraryFilterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY });
    },
  });
}

export function useDetachLibraryFilter() {
  const qc = useQueryClient();
  return useMutation<void, Error, { subscriptionId: number; libraryFilterId: number }>({
    mutationFn: ({ subscriptionId, libraryFilterId }) =>
      detachLibraryFilter(subscriptionId, libraryFilterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY });
    },
  });
}
