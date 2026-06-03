import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  resolveSubscription,
  updateSubscription,
} from '@/api/subscriptionsApi';
import type {
  CreateSubscriptionRequest,
  ResolveSubscriptionResponse,
  SubscriptionDto,
  UpdateSubscriptionRequest,
} from '@tg-feed/shared';

export const SUBSCRIPTIONS_KEY = ['subscriptions'] as const;
// Duplicated from useFilters.ts (avoids a circular import); keep in sync with subscriptionFiltersKey.
const SUB_FILTERS_KEY_PREFIX = ['subscription-filters'] as const;

export function useSubscriptions() {
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: listSubscriptions,
    select: (res) => res.items,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation<SubscriptionDto, Error, CreateSubscriptionRequest>({
    mutationFn: createSubscription,
    onSuccess: (sub) => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      // The create body may carry inline filters, so refresh the per-sub filter query.
      qc.invalidateQueries({ queryKey: [...SUB_FILTERS_KEY_PREFIX, sub.id] });
    },
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation<SubscriptionDto, Error, { id: number; body: UpdateSubscriptionRequest }>({
    mutationFn: ({ id, body }) => updateSubscription(id, body),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      qc.invalidateQueries({ queryKey: [...SUB_FILTERS_KEY_PREFIX, id] });
    },
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteSubscription,
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
  });
}

export function useResolveSubscription() {
  return useMutation<ResolveSubscriptionResponse, Error, string>({
    mutationFn: resolveSubscription,
  });
}
