/**
 * Internal filter types.
 *
 * `MessageContext` is the subset of message data filters need — text body,
 * media presence, sender username. The forwarding pipeline's `MatchableEvent`
 * structurally satisfies this, so the listener can hand a matchable event
 * straight to the evaluator without transformation.
 *
 * Rule definitions are statically typed via `FilterRule<T>`, but the
 * registry/evaluator boundary erases the connection between a rule's `type`
 * and its params shape (params come from a JSON column and are runtime-
 * validated by the rule's own zod schema). The type-erased
 * `RegisteredFilterRule` is what the registry stores and exposes.
 */
import type { z } from 'zod';
import type { FilterRuleParamsFor, FilterRuleType } from '@tg-feed/shared';

export interface MessageContext {
  text: string;
  hasMedia: boolean;
  senderUsername?: string;
  /**
   * Carrier for the raw-message JSON snapshot. The filter rules themselves
   * don't read this — it rides through `evaluate()` only so the rejection
   * path can persist it on the `forward_log` row alongside the reasons.
   * Single object for non-albums, array for albums (aligned with the
   * `sourceMessageIds` the evaluator receives).
   */
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
