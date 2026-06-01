/**
 * Shared rule-draft state for the filter editors.
 *
 * Both the standalone `FilterSheet` and the inline-filter editor inside
 * `SubSheet` drive the same little flow: pick a rule type (which seeds its
 * default params and resets the include/exclude mode), edit the params,
 * validate them against `filterRuleParamsSchemas[ruleType]`, then parse the
 * validated payload on commit. This hook owns that logic so the two sheets
 * don't each hand-roll (and drift on) it; each still renders its own step UI.
 */
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  filterRuleDefaultParams,
  filterRuleParamsSchemas,
  type FilterMode,
  type FilterRuleType,
} from '@tg-feed/shared';

export interface FilterDraft {
  ruleType: FilterRuleType | null;
  params: Record<string, unknown>;
  mode: FilterMode;
  setParams: Dispatch<SetStateAction<Record<string, unknown>>>;
  setMode: Dispatch<SetStateAction<FilterMode>>;
  /** Select a rule type: seeds its default params and resets mode to 'include'. */
  pickType: (t: FilterRuleType) => void;
  /** Load an existing filter for editing. */
  load: (rule: FilterRuleType, params: Record<string, unknown>, mode: FilterMode) => void;
  /** Clear back to the empty draft. */
  reset: () => void;
  /** True when the current params validate against the rule's schema. */
  valid: boolean;
  /** Parse + return the validated params. Throws if there's no rule — guard with `valid`. */
  parseParams: () => Record<string, unknown>;
}

export function useFilterDraft(): FilterDraft {
  const [ruleType, setRuleType] = useState<FilterRuleType | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<FilterMode>('include');

  const pickType = useCallback((t: FilterRuleType) => {
    setRuleType(t);
    setParams({ ...filterRuleDefaultParams[t] });
    setMode('include');
  }, []);

  const load = useCallback((rule: FilterRuleType, p: Record<string, unknown>, m: FilterMode) => {
    setRuleType(rule);
    setParams({ ...p });
    setMode(m);
  }, []);

  const reset = useCallback(() => {
    setRuleType(null);
    setParams({});
    setMode('include');
  }, []);

  const valid = useMemo(
    () => (ruleType ? filterRuleParamsSchemas[ruleType].safeParse(params).success : false),
    [ruleType, params],
  );

  const parseParams = useCallback((): Record<string, unknown> => {
    if (!ruleType) throw new Error('useFilterDraft.parseParams called with no rule type');
    return filterRuleParamsSchemas[ruleType].parse(params) as Record<string, unknown>;
  }, [ruleType, params]);

  return { ruleType, params, mode, setParams, setMode, pickType, load, reset, valid, parseParams };
}
