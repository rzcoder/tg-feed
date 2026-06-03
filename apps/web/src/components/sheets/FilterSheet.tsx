import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { RuleForm } from '@/components/domain/RuleForm';
import { RuleListItem } from '@/components/domain/RuleListItem';

export type FilterSheetKind = 'sub' | 'library';

export interface FilterSheetSubmit {
  ruleType: FilterRuleType;
  params: Record<string, unknown>;
  mode: FilterMode;
  // Only set when kind='library'.
  name?: string;
}

export interface FilterSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  kind: FilterSheetKind;
  initial?: SubscriptionFilterDto | LibraryFilterDto | null;
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
  const [name, setName] = useState('');
  // Draft mode aliased to filterMode since `mode` is already the add/edit prop.
  const {
    ruleType: type,
    params,
    mode: filterMode,
    setParams,
    setMode: setFilterMode,
    pickType,
    load: loadDraft,
    reset: resetDraft,
    valid: paramsValid,
    parseParams,
  } = useFilterDraft();

  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setStep(2);
      loadDraft(initial.ruleType, initial.params, initial.mode);
      setName((initial as LibraryFilterDto).name ?? '');
    } else {
      setStep(1);
      resetDraft();
      setName('');
    }
  }, [open, isEdit, initial, loadDraft, resetDraft]);

  const onPickType = useCallback(
    (t: FilterRuleType) => {
      pickType(t);
      setStep(2);
    },
    [pickType],
  );

  const canSave = useMemo(() => {
    if (submitting || !type) return false;
    if (isLibrary && !name.trim()) return false;
    return paramsValid;
  }, [submitting, type, isLibrary, name, paramsValid]);

  const handleSubmit = () => {
    if (!canSave || !type) return;
    onSubmit({
      ruleType: type,
      params: parseParams(),
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
            <RuleListItem key={rt} ruleType={rt} selected={type === rt} onSelect={onPickType} />
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

interface RulePreviewCardProps {
  ruleType: FilterRuleType;
}

function RulePreviewCard({ ruleType }: RulePreviewCardProps) {
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
