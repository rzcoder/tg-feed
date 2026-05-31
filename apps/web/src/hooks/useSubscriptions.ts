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
// Mirrors `subscriptionFiltersKey` in useFilters.ts. Duplicated here (rather
// than imported) to avoid a circular hooks import — both files reference
// each other's keys for cross-invalidation. Keep these prefixes in sync.
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
      // The new sub may carry inline filters set via the create body;
      // invalidate so PerSubView's per-sub query reflects them.
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
