/**
 * Filter framework barrel.
 *
 * Adding a new rule:
 *   1. Drop `apps/server/src/filters/rules/<name>.ts` exporting a
 *      `FilterRule<'<name>'>` value.
 *   2. Add a matching schema entry in `packages/shared/src/filters.ts`.
 *   3. Register it in `apps/server/src/filters/rules/index.ts`'s
 *      `createDefaultRegistry()`.
 */
export type {
  FilterEvaluationResult,
  FilterRule,
  MessageContext,
  RegisteredFilterRule,
} from './types.js';
export { createRegistry, type FilterRegistry } from './registry.js';
export {
  createFilterEvaluator,
  evaluateFilters,
  type CreateFilterEvaluatorDeps,
  type FilterEvaluator,
} from './evaluate.js';
export { createDefaultRegistry } from './rules/index.js';
