// MatchableEvent structurally satisfies MessageContext, so the listener feeds the evaluator without transforming.
// RegisteredFilterRule is the type-erased form the registry stores: the type->params link is lost across the JSON/zod boundary.
import type { z } from 'zod';
import type { FilterRuleParamsFor, FilterRuleType } from '@tg-feed/shared';

// 'text' = a URL visible in the message body; 'entity' = a hidden hyperlink target (its display text differs).
export type LinkSource = 'text' | 'entity';

export interface MessageLink {
  url: string;
  source: LinkSource;
}

export interface MessageContext {
  text: string;
  hasMedia: boolean;
  // Number of media items: 1 for a single media message, N for an album, 0 for text-only.
  mediaCount?: number;
  senderUsername?: string;
  // Unread by rules; rides through evaluate() so the rejection path can persist it on forward_log. Array for albums.
  rawMessage?: unknown;
  // Text carried by entities but absent from `text`: hidden hyperlink targets and code-block language tags. Searched only by text rules that opt in.
  entityTexts?: string[];
  // Every link on the message, tagged by where it lives. Read by the link-prefix rule.
  links?: MessageLink[];
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
