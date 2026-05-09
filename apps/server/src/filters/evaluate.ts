/**
 * Filter evaluator.
 *
 * Loads enabled `subscription_filters` rows for a subscription, runs each
 * through its registered rule, AND-combines, and on failure writes one
 * `forward_log` row per source message id (status `'filtered'`, reasons
 * joined into the `error` column).
 *
 * Fail-open semantics for broken filter rows: an unknown ruleType, a zod
 * params parse failure, or a runtime throw inside a rule's `evaluate`
 * causes that single row to be skipped (with a warning). The remaining
 * rules still gate the message. Empty surviving filter set passes
 * (vacuous AND).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { forwardLog, subscriptionFilters, type SubscriptionFilter } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import type { FilterRegistry } from './registry.js';
import type { MessageContext } from './types.js';

export interface FilterEvaluator {
  evaluate(
    context: MessageContext,
    subscriptionId: number,
    sourceMessageIds: readonly string[],
  ): { pass: boolean };
}

export interface CreateFilterEvaluatorDeps {
  db: Db;
  registry: FilterRegistry;
  logger: Logger;
  bus: EventBus;
}

interface PureEvaluation {
  pass: boolean;
  reasons: string[];
}

export function createFilterEvaluator(deps: CreateFilterEvaluatorDeps): FilterEvaluator {
  const { db, registry, logger, bus } = deps;

  return {
    evaluate(
      context: MessageContext,
      subscriptionId: number,
      sourceMessageIds: readonly string[],
    ): { pass: boolean } {
      const rows = db
        .select()
        .from(subscriptionFilters)
        .where(
          and(
            eq(subscriptionFilters.subscriptionId, subscriptionId),
            eq(subscriptionFilters.enabled, true),
          ),
        )
        .orderBy(asc(subscriptionFilters.id))
        .all();

      const result = evaluateFilters(rows, registry, context, logger);
      if (result.pass) return { pass: true };

      const errorText = result.reasons.join('; ');
      for (const sourceMessageId of sourceMessageIds) {
        db.insert(forwardLog)
          .values({
            subscriptionId,
            sourceMessageId,
            destMessageId: null,
            status: 'filtered',
            error: errorText,
          })
          .run();
      }
      logger.info(
        {
          subscriptionId,
          sourceMessageIds,
          reasons: result.reasons,
        },
        'message filtered',
      );
      bus.emit({
        type: 'forward.filtered',
        subscriptionId,
        sourceMessageIds: [...sourceMessageIds],
        reasons: [...result.reasons],
      });
      return { pass: false };
    },
  };
}

/**
 * Pure evaluation — no side effects. Exported for unit tests; the public
 * `FilterEvaluator.evaluate` method is what production wiring calls.
 */
export function evaluateFilters(
  rows: readonly SubscriptionFilter[],
  registry: FilterRegistry,
  context: MessageContext,
  logger: Logger,
): PureEvaluation {
  const reasons: string[] = [];

  for (const row of rows) {
    const rule = registry.getRule(row.ruleType);
    if (!rule) {
      logger.warn(
        { subscriptionFilterId: row.id, ruleType: row.ruleType },
        'unknown filter rule type, skipping (fail-open)',
      );
      continue;
    }

    const parsed = rule.paramsSchema.safeParse(row.params);
    if (!parsed.success) {
      logger.warn(
        {
          subscriptionFilterId: row.id,
          ruleType: row.ruleType,
          issues: parsed.error.issues,
        },
        'invalid filter params, skipping (fail-open)',
      );
      continue;
    }

    let evaluation;
    try {
      evaluation = rule.evaluate(context, parsed.data);
    } catch (err) {
      logger.error(
        { subscriptionFilterId: row.id, ruleType: row.ruleType, err },
        'filter rule threw, skipping (fail-open)',
      );
      continue;
    }

    if (!evaluation.pass) {
      reasons.push(`${row.ruleType}: ${evaluation.reason ?? 'no match'}`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}
