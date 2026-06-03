// MatchableEvent structurally satisfies MessageContext, so the listener feeds the evaluator without transforming.
// RegisteredFilterRule is the type-erased form the registry stores: the type->params link is lost across the JSON/zod boundary.
import type { z } from 'zod';
import type { FilterRuleParamsFor, FilterRuleType } from '@tg-feed/shared';

export interface MessageContext {
  text: string;
  hasMedia: boolean;
  senderUsername?: string;
  // Unread by rules; rides through evaluate() so the rejection path can persist it on forward_log. Array for albums.
  rawMessage?: unknown;
}

export interface FilterEvaluationResult {
  pass: boolean;
  reason?: string;
}

export interface FilterRule<T extends FilterRuleType> {
  readonly type: T;
  readonly label: string;
  readonly paramsSchema: z.ZodTypeAny;
  evaluate(context: MessageContext, params: FilterRuleParamsFor<T>): FilterEvaluationResult;
}

export interface RegisteredFilterRule {
  readonly type: FilterRuleType;
  readonly label: string;
  readonly paramsSchema: z.ZodTypeAny;
  evaluate(context: MessageContext, params: unknown): FilterEvaluationResult;
}
