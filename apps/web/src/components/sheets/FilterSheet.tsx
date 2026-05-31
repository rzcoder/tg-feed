/**
 * Two-step filter creation/edit sheet.
 *
 * Step 1 (add only) — pick a rule from the catalogue list.
 * Step 2 — fill the params for the picked rule.
 *
 * Used in three modes:
 * - kind='sub' add: attach a per-sub filter (no Name field)
 * - kind='sub' edit: edit per-sub filter params (skip step 1)
 * - kind='library' add/edit: same flow plus a Name field
 */
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  filterRuleDefaultParams,
  filterRuleParamsSchemas,
  type FilterMode,
  type FilterRuleType,
  type LibraryFilterDto,
  type SubscriptionFilterDto,
} from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  FILTER_RULE_DESCRIPTIONS,
  FILTER_RULE_ICONS,
  FILTER_RULE_LABELS,
} from '@/lib/describeFilter';
import { RuleForm } from '@/components/domain/RuleForm';
import { RuleListItem } from '@/components/domain/RuleListItem';

export type FilterSheetKind = 'sub' | 'library';

export interface FilterSheetSubmit {
  ruleType: FilterRuleType;
  params: Record<string, unknown>;
  mode: FilterMode;
  /** Name only set when kind='library'. */
  name?: string;
}

export interface FilterSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  kind: FilterSheetKind;
  initial?: SubscriptionFilterDto | LibraryFilterDto | null;
  /** Available rule types from the API catalogue (filtered by support). */
  availableTypes: readonly FilterRuleType[];
  onClose: () => void;
  onSubmit: (data: FilterSheetSubmit) => void;
  submitting?: boolean;
}

export function FilterSheet({
  open,
  mode,
  kind,
  initial,
  availableTypes,
  onClose,
  onSubmit,
  submitting,
}: FilterSheetProps) {
  const isEdit = mode === 'edit';
  const isLibrary = kind === 'library';

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<FilterRuleType | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  // `mode` is taken by the add/edit prop on this component — disambiguate
  // the include/exclude state as `filterMode`.
  const [filterMode, setFilterMode] = useState<FilterMode>('include');
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setStep(2);
      setType(initial.ruleType);
      setParams({ ...initial.params });
      setFilterMode(initial.mode);
      const initialName = (initial as LibraryFilterDto).name ?? '';
      setName(initialName);
    } else {
      setStep(1);
      setType(null);
      setParams({});
      setFilterMode('include');
      setName('');
    }
  }, [open, isEdit, initial]);

  const onPickType = (t: FilterRuleType) => {
    setType(t);
    setParams({ ...filterRuleDefaultParams[t] });
    setFilterMode('include');
    setStep(2);
  };

  const canSave = (() => {
    if (submitting || !type) return false;
    if (isLibrary && !name.trim()) return false;
    // Validate params against the schema before allowing save — keeps the
    // server's 400 path for genuine wire-tampering rather than ordinary
    // form errors.
    const result = filterRuleParamsSchemas[type].safeParse(params);
    return result.success;
  })();

  const handleSubmit = () => {
    if (!canSave || !type) return;
    const validated = filterRuleParamsSchemas[type].parse(params);
    onSubmit({
      ruleType: type,
      params: validated as Record<string, unknown>,
      mode: filterMode,
      ...(isLibrary ? { name: name.trim() } : {}),
    });
  };

  const titlePrefix = isLibrary
    ? isEdit
      ? 'Edit library filter'
      : 'New library filter'
    : isEdit
      ? 'Edit filter'
      : 'Add filter';

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={step === 1 && !isEdit ? `${titlePrefix} — choose a rule` : titlePrefix}
      footer={
        step === 2 ? (
          <>
            {!isEdit && (
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft size={14} /> Back
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!canSave} onClick={handleSubmit}>
              {isEdit ? 'Save' : 'Add'}
            </Button>
          </>
        ) : null
      }
    >
      {step === 1 && !isEdit && (
        <div className="border border-border rounded-[10px] overflow-hidden bg-bg">
          {availableTypes.map((rt) => (
            <RuleListItem
              key={rt}
              ruleType={rt}
              selected={type === rt}
              onClick={() => onPickType(rt)}
            />
          ))}
        </div>
      )}

      {step === 2 && type && (
        <div className="flex flex-col gap-3">
          <RulePreviewCard ruleType={type} />
          <RuleForm
            type={type}
            params={params}
            setParams={setParams}
            mode={filterMode}
            setMode={setFilterMode}
            showName={isLibrary}
            name={name}
            setName={setName}
          />
        </div>
      )}
    </Sheet>
  );
}

function RulePreviewCard({ ruleType }: { ruleType: FilterRuleType }) {
  const Icon = FILTER_RULE_ICONS[ruleType];
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-2 border border-border">
      <span className="grid place-items-center w-7 h-7 rounded-md bg-accent text-accent-fg flex-shrink-0">
        <Icon size={14} />
      </span>
      <div className="flex flex-col gap-px">
        <div className="text-[13px] font-semibold">{FILTER_RULE_LABELS[ruleType]}</div>
        <div className="text-[11.5px] text-text-muted">{FILTER_RULE_DESCRIPTIONS[ruleType]}</div>
      </div>
    </div>
  );
}
