/**
 * Filter evaluator.
 *
 * Loads enabled filters for a subscription — both per-sub
 * (`subscription_filters` where `enabled=true`) and library filters
 * attached via `subscription_library_filters` — runs each through its
 * registered rule, AND-combines, and on failure writes one `forward_log`
 * row per source message id (status `'filtered'`, reasons joined into
 * the `error` column).
 *
 * Reasons format:
 * - per-sub: `"<ruleType>: <reason>"`
 * - library: `"library:<name>: <ruleType>: <reason>"` so the activity UI
 *   can split on the `library:` prefix and render a Library chip.
 *
 * Fail-open semantics from Ch 6 are preserved across both sources: an
 * unknown ruleType, a zod params parse failure, or a runtime throw inside
 * a rule's `evaluate` skips that single row (with a warning). The
 * remaining rules still gate the message. Empty surviving filter set
 * passes (vacuous AND).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  forwardLog,
  libraryFilters,
  subscriptionFilters,
  subscriptionLibraryFilters,
} from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import type { FilterRegistry } from './registry.js';
import type { MessageContext } from './types.js';
import type { AnyFilterRuleParams, FilterMode, FilterRuleType } from '@tg-feed/shared';

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

/**
 * Row shape consumed by the pure evaluator. `source` distinguishes per-sub
 * vs library; `label` is the library filter name (null for per-sub). `mode`
 * inverts the rule for that one row when set to `'exclude'` — the filter
 * rejects when its rule matches instead of when it doesn't.
 */
export interface EvaluatorRow {
  id: number;
  source: 'sub' | 'lib';
  ruleType: FilterRuleType;
  params: AnyFilterRuleParams;
  label: string | null;
  mode: FilterMode;
}

export function createFilterEvaluator(deps: CreateFilterEvaluatorDeps): FilterEvaluator {
  const { db, registry, logger, bus } = deps;

  return {
    evaluate(
      context: MessageContext,
      subscriptionId: number,
      sourceMessageIds: readonly string[],
    ): { pass: boolean } {
      const rows = loadEvaluatorRows(db, subscriptionId);
      const result = evaluateFilters(rows, registry, context, logger);
      if (result.pass) return { pass: true };

      const errorText = result.reasons.join('; ');
      db.insert(forwardLog)
        .values(
          sourceMessageIds.map((sourceMessageId) => ({
            subscriptionId,
            sourceMessageId,
            destMessageId: null,
            status: 'filtered' as const,
            error: errorText,
          })),
        )
        .run();
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
 * Load all evaluatable filters for a subscription as a single ordered list.
 *
 * Per-sub filters (where `enabled=true`) and library filters attached via
 * `subscription_library_filters` are loaded with two selects and merged in
 * JS. Library rows come first (`source ASC: 'lib' < 'sub'`), then by id.
 *
 * Two queries instead of a SQL UNION because drizzle's mapped JSON columns
 * (`mode: 'json'` in the schema) flow through cleanly per-table; a raw
 * UNION returns columns as strings and would need manual `JSON.parse`. The
 * cost is one extra round-trip on a hot path — for personal-use volumes
 * (single-digit messages/sec at most) this is comfortably below noise.
 */
export function loadEvaluatorRows(db: Db, subscriptionId: number): EvaluatorRow[] {
  const subRows = db
    .select({
      id: subscriptionFilters.id,
      ruleType: subscriptionFilters.ruleType,
      params: subscriptionFilters.params,
      mode: subscriptionFilters.mode,
    })
    .from(subscriptionFilters)
    .where(
      and(
        eq(subscriptionFilters.subscriptionId, subscriptionId),
        eq(subscriptionFilters.enabled, true),
      ),
    )
    .orderBy(asc(subscriptionFilters.id))
    .all();

  const libRows = db
    .select({
      id: libraryFilters.id,
      ruleType: libraryFilters.ruleType,
      params: libraryFilters.params,
      name: libraryFilters.name,
      mode: libraryFilters.mode,
    })
    .from(libraryFilters)
    .innerJoin(
      subscriptionLibraryFilters,
      eq(subscriptionLibraryFilters.libraryFilterId, libraryFilters.id),
    )
    .where(eq(subscriptionLibraryFilters.subscriptionId, subscriptionId))
    .orderBy(asc(libraryFilters.id))
    .all();

  const merged: EvaluatorRow[] = [
    ...libRows.map((r) => ({
      id: r.id,
      source: 'lib' as const,
      ruleType: r.ruleType,
      params: r.params,
      label: r.name,
      mode: r.mode,
    })),
    ...subRows.map((r) => ({
      id: r.id,
      source: 'sub' as const,
      ruleType: r.ruleType,
      params: r.params,
      label: null,
      mode: r.mode,
    })),
  ];
  return merged;
}

/**
 * Pure evaluation — no side effects. Exported for unit tests; the public
 * `FilterEvaluator.evaluate` method is what production wiring calls.
 */
export function evaluateFilters(
  rows: readonly EvaluatorRow[],
  registry: FilterRegistry,
  context: MessageContext,
  logger: Logger,
): PureEvaluation {
  const reasons: string[] = [];

  for (const row of rows) {
    const rule = registry.getRule(row.ruleType);
    if (!rule) {
      logger.warn(
        { source: row.source, refId: row.id, ruleType: row.ruleType },
        'unknown filter rule type, skipping (fail-open)',
      );
      continue;
    }

    const parsed = rule.paramsSchema.safeParse(row.params);
    if (!parsed.success) {
      logger.warn(
        {
          source: row.source,
          refId: row.id,
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
        { source: row.source, refId: row.id, ruleType: row.ruleType, err },
        'filter rule threw, skipping (fail-open)',
      );
      continue;
    }

    // include: row fails when the rule did NOT match; exclude inverts that —
    // the row fails when the rule DID match. Either way, a failing row
    // contributes a reason and the message is rejected (AND-combined).
    const blocks = row.mode === 'exclude' ? evaluation.pass : !evaluation.pass;
    if (blocks) {
      const reason =
        row.mode === 'exclude' ? 'matched (exclude)' : (evaluation.reason ?? 'no match');
      const ruleLabel = row.mode === 'exclude' ? `exclude:${row.ruleType}` : row.ruleType;
      const formatted =
        row.source === 'lib' && row.label !== null
          ? `library:${row.label}: ${ruleLabel}: ${reason}`
          : `${ruleLabel}: ${reason}`;
      reasons.push(formatted);
    }
  }

  return { pass: reasons.length === 0, reasons };
}
