// AND-combines a subscription's per-sub + library filter rules; fail-open (unknown rule, bad params, or a throw skips that one row with a warning).
// Reason format: `library:<name>: <ruleType>: <reason>` for library rows (UI splits on the `library:` prefix), else `<ruleType>: <reason>`.
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

// mode 'exclude' inverts the row: it rejects when the rule matches.
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
      // Denormalize the raw payload onto every row so each is independently inspectable.
      const rawMessage = context.rawMessage ?? null;
      const inserted = db
        .insert(forwardLog)
        .values(
          sourceMessageIds.map((sourceMessageId) => ({
            subscriptionId,
            sourceMessageId,
            destMessageId: null,
            status: 'filtered' as const,
            error: errorText,
            rawMessage,
          })),
        )
        .returning({ id: forwardLog.id })
        .all();
      const forwardLogIds = inserted.map((row) => row.id);
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
        forwardLogIds,
      });
      return { pass: false };
    },
  };
}

// Two selects merged in JS (library rows first, then by id) rather than a SQL UNION, which would stringify drizzle's JSON columns.
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

// Pure evaluation, no side effects; the side-effecting wrapper is FilterEvaluator.evaluate.
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
