import { ValidationError } from '../lib/errors.js';
import { getCompiledRegex } from './rules/textRegex.js';

// Write-time validation beyond the zod schema: a text-regex pattern must actually compile,
// so an invalid one is rejected at save time instead of failing open per-message at eval.
// Assumes params already passed their zod schema (pattern/flags are strings).
export function assertFilterParamsCompilable(ruleType: string, params: unknown): void {
  if (ruleType !== 'text-regex') return;
  const { pattern, flags } = params as { pattern: string; flags?: string };
  try {
    getCompiledRegex(pattern, flags ?? '');
  } catch (err) {
    throw new ValidationError(
      `invalid text-regex pattern: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
