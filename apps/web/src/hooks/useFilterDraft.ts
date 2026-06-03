// Shared rule-draft state so FilterSheet and SubSheet's inline editor don't drift.
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
  // Seeds the rule's default params and resets mode to 'include'.
  pickType: (t: FilterRuleType) => void;
  load: (rule: FilterRuleType, params: Record<string, unknown>, mode: FilterMode) => void;
  reset: () => void;
  valid: boolean;
  // Throws if there's no rule — guard with `valid`.
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
