import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, Check, Plus } from 'lucide-react';
import {
  filterRuleParamsSchemas,
  type DestinationDto,
  type FilterRuleType,
  type InlineFilterInput,
  type LibraryFilterDto,
  type SubscriptionDto,
} from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { describeFilter } from '@/lib/describeFilter';
import { useResolveSubscription } from '@/hooks/useSubscriptions';
import { useSubscriptionFilters } from '@/hooks/useFilters';
import { ApiError } from '@/api/client';
import { FilterRow } from '@/components/domain/FilterRow';
import { RuleForm } from '@/components/domain/RuleForm';
import { RuleListItem } from '@/components/domain/RuleListItem';

export interface InlineFilterDraft {
  /** Stable react key for the lifetime of an unsaved row. */
  clientKey: string;
  ruleType: FilterRuleType;
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface SubSheetSubmit {
  sourceChatId: string;
  sourceTitle: string;
  handle: string | null;
  destinationId: number;
  libraryFilterIds: number[];
  /**
   * Bulk-replace set of private inline filters. Empty array = drop all on
   * save. Each entry has been validated against
   * `filterRuleParamsSchemas[ruleType]` so `params` matches the discriminator.
   */
  inlineFilters: InlineFilterInput[];
}

export interface SubSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  initial?: SubscriptionDto | null;
  destinations: DestinationDto[];
  library: LibraryFilterDto[];
  /** Catalog of supported rule types (from `useFilterCatalog`). */
  availableTypes: readonly FilterRuleType[];
  onClose: () => void;
  onSubmit: (data: SubSheetSubmit) => void;
  submitting?: boolean;
}

// Mirrors `FilterSheet` defaults — kept in sync intentionally; per-rule
// schemas live in `@tg-feed/shared` but the seed values are UI concerns.
const DEFAULTS: Record<FilterRuleType, Record<string, unknown>> = {
  'text-contains': { value: '', caseInsensitive: true },
  'text-excludes': { value: '', caseInsensitive: true },
  'text-regex': { pattern: '', flags: 'i' },
  'has-media': { required: true },
  'min-length': { min: 50 },
  'sender-allowlist': { usernames: [] },
};

type SubFilterStep =
  | { kind: 'list' }
  | { kind: 'pick-rule' }
  | { kind: 'edit-params'; index: number };

export function SubSheet({
  open,
  mode,
  initial,
  destinations,
  library,
  availableTypes,
  onClose,
  onSubmit,
  submitting,
}: SubSheetProps) {
  const isEdit = mode === 'edit';
  const [link, setLink] = useState('');
  const [destId, setDestId] = useState<number | null>(null);
  const [libIds, setLibIds] = useState<number[]>([]);
  const [inlineFilters, setInlineFilters] = useState<InlineFilterDraft[]>([]);
  const [step, setStep] = useState<SubFilterStep>({ kind: 'list' });
  // Step-local draft buffer; committed back into `inlineFilters` only on Save.
  const [draftRule, setDraftRule] = useState<FilterRuleType | null>(null);
  const [draftParams, setDraftParams] = useState<Record<string, unknown>>({});

  const {
    mutate: mutateResolve,
    reset: resetResolve,
    data: resolveData,
    isPending: resolvePending,
    error: resolveErrorRaw,
  } = useResolveSubscription();

  // Pull existing inline filters in edit mode so the user sees and can edit
  // what they already have. Only enabled when the sheet is open + edit mode.
  const filtersQuery = useSubscriptionFilters(isEdit && open && initial ? initial.id : null);

  // Reset on open / mode change.
  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setLink(initial.handle ?? `@${initial.sourceTitle}`);
      setDestId(initial.destinationId);
      setLibIds([...initial.libraryFilterIds]);
      // inlineFilters seeded from filtersQuery.data when it lands (effect below).
      resetResolve();
    } else {
      setLink('');
      setDestId(destinations[0]?.id ?? null);
      setLibIds([]);
      setInlineFilters([]);
      resetResolve();
    }
    setStep({ kind: 'list' });
    setDraftRule(null);
    setDraftParams({});
  }, [open, isEdit, initial, destinations, resetResolve]);

  // Seed inline filters from the server once they land. Ignored on subsequent
  // refetches so the user's in-progress edits aren't clobbered.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (!isEdit) return;
    if (seeded) return;
    if (!filtersQuery.data) return;
    setInlineFilters(
      filtersQuery.data.map((f) => ({
        clientKey: cryptoUuid(),
        ruleType: f.ruleType,
        params: { ...f.params },
        enabled: f.enabled,
      })),
    );
    setSeeded(true);
  }, [open, isEdit, seeded, filtersQuery.data]);

  // Debounce resolve in add mode.
  useEffect(() => {
    if (isEdit) return;
    const trimmed = link.trim();
    if (trimmed.length < 4) {
      resetResolve();
      return;
    }
    const t = setTimeout(() => {
      mutateResolve(trimmed);
    }, 600);
    return () => clearTimeout(t);
  }, [link, isEdit, mutateResolve, resetResolve]);

  const resolved = !isEdit ? resolveData : null;
  const resolving = !isEdit && resolvePending;
  const resolveError = !isEdit ? resolveErrorRaw : null;

  const draftValid = useMemo(() => {
    if (!draftRule) return false;
    return filterRuleParamsSchemas[draftRule].safeParse(draftParams).success;
  }, [draftRule, draftParams]);

  const canSave = (() => {
    if (submitting) return false;
    if (destId === null) return false;
    if (isEdit) return true;
    return !!resolved && !resolving;
  })();

  const handleSubmit = () => {
    if (!canSave || destId === null) return;
    // Each draft was already parsed through `filterRuleParamsSchemas[ruleType]`
    // before landing in `inlineFilters`, so the runtime shape matches the
    // discriminated union — TS just can't prove it via dynamic key lookup.
    const wireInline = inlineFilters.map(
      (d) =>
        ({
          ruleType: d.ruleType,
          params: d.params,
          enabled: d.enabled,
        }) as InlineFilterInput,
    );
    if (isEdit && initial) {
      onSubmit({
        sourceChatId: initial.sourceChatId,
        sourceTitle: initial.sourceTitle,
        handle: initial.handle,
        destinationId: destId,
        libraryFilterIds: libIds,
        inlineFilters: wireInline,
      });
    } else if (resolved) {
      onSubmit({
        sourceChatId: resolved.sourceChatId,
        sourceTitle: resolved.sourceTitle,
        handle: resolved.handle,
        destinationId: destId,
        libraryFilterIds: libIds,
        inlineFilters: wireInline,
      });
    }
  };

  const toggleLib = (id: number) => {
    setLibIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const startAddInline = () => {
    setDraftRule(null);
    setDraftParams({});
    setStep({ kind: 'pick-rule' });
  };
  const pickInlineRule = (rt: FilterRuleType) => {
    setDraftRule(rt);
    setDraftParams({ ...DEFAULTS[rt] });
    setStep({ kind: 'edit-params', index: -1 });
  };
  const startEditInline = (index: number) => {
    const row = inlineFilters[index]!;
    setDraftRule(row.ruleType);
    setDraftParams({ ...row.params });
    setStep({ kind: 'edit-params', index });
  };
  const commitDraft = () => {
    if (!draftRule || !draftValid) return;
    const validated = filterRuleParamsSchemas[draftRule].parse(draftParams) as Record<
      string,
      unknown
    >;
    setInlineFilters((prev) => {
      if (step.kind !== 'edit-params') return prev;
      if (step.index === -1) {
        return [
          ...prev,
          {
            clientKey: cryptoUuid(),
            ruleType: draftRule,
            params: validated,
            enabled: true,
          },
        ];
      }
      return prev.map((row, i) =>
        i === step.index ? { ...row, ruleType: draftRule, params: validated } : row,
      );
    });
    setStep({ kind: 'list' });
    setDraftRule(null);
    setDraftParams({});
  };
  const cancelDraft = () => {
    setStep({ kind: 'list' });
    setDraftRule(null);
    setDraftParams({});
  };
  const removeInline = (index: number) => {
    setInlineFilters((prev) => prev.filter((_, i) => i !== index));
  };
  const toggleInline = (index: number) => {
    setInlineFilters((prev) =>
      prev.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row)),
    );
  };

  const title = (() => {
    if (step.kind === 'pick-rule') return 'Custom filter — choose a rule';
    if (step.kind === 'edit-params') {
      return step.index === -1 ? 'Custom filter — params' : 'Edit custom filter';
    }
    return isEdit ? 'Edit subscription' : 'Add subscription';
  })();

  const footer = (() => {
    if (step.kind === 'pick-rule') {
      return (
        <Button variant="ghost" size="sm" onClick={cancelDraft}>
          <ChevronLeft size={14} /> Back
        </Button>
      );
    }
    if (step.kind === 'edit-params') {
      return (
        <>
          <Button variant="ghost" size="sm" onClick={cancelDraft}>
            <ChevronLeft size={14} /> Back
          </Button>
          <div className="flex-1" />
          <Button variant="primary" size="sm" disabled={!draftValid} onClick={commitDraft}>
            {step.index === -1 ? 'Add' : 'Save'}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={handleSubmit}>
          {isEdit ? 'Save' : 'Add'}
        </Button>
      </>
    );
  })();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={title} footer={footer}>
      {step.kind === 'pick-rule' && (
        <div className="border border-border rounded-[10px] overflow-hidden bg-bg">
          {availableTypes.map((rt) => (
            <RuleListItem key={rt} ruleType={rt} onClick={() => pickInlineRule(rt)} />
          ))}
        </div>
      )}

      {step.kind === 'edit-params' && draftRule && (
        <div className="flex flex-col gap-3">
          <RuleForm type={draftRule} params={draftParams} setParams={setDraftParams} />
        </div>
      )}

      {step.kind === 'list' && (
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="sub-link">Source channel</Label>
            <Input
              id="sub-link"
              value={link}
              onChange={(e) => !isEdit && setLink(e.target.value)}
              disabled={isEdit}
              placeholder="@channel or t.me/channel"
              autoFocus={!isEdit}
              monospace
            />
            {!isEdit && <Hint>Paste a Telegram link or @username.</Hint>}
            {isEdit && <Hint>Source channel can't be changed — delete and re-add to switch.</Hint>}
          </div>

          {!isEdit && (resolving || resolved || resolveError) && (
            <ResolvedCard resolving={resolving} resolved={resolved} error={resolveError} />
          )}

          <div>
            <Label>Destination</Label>
            <div className="flex flex-col gap-1.5">
              {destinations.map((d) => (
                <DestRadio
                  key={d.id}
                  destination={d}
                  selected={destId === d.id}
                  onSelect={() => setDestId(d.id)}
                />
              ))}
              {destinations.length === 0 && (
                <Hint>No destinations — add one in the Destinations tab first.</Hint>
              )}
            </div>
          </div>

          <div>
            <Label>
              Library filters <span className="text-text-faint font-normal">(optional)</span>
            </Label>
            <div className="flex flex-col gap-1.5">
              {library.length === 0 ? (
                <Hint>No library filters yet — create reusable rules in Filters → Library.</Hint>
              ) : (
                library.map((l) => (
                  <LibCheckbox
                    key={l.id}
                    filter={l}
                    selected={libIds.includes(l.id)}
                    onToggle={() => toggleLib(l.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="mb-0">
                Custom filters{' '}
                <span className="text-text-faint font-normal">(private to this subscription)</span>
              </Label>
              <Button variant="ghost" size="sm" onClick={startAddInline}>
                <Plus size={13} /> Add
              </Button>
            </div>
            {isEdit && filtersQuery.isPending && !seeded ? (
              <div className="grid place-items-center py-3">
                <Spinner size={14} />
              </div>
            ) : inlineFilters.length === 0 ? (
              <Hint>
                Private filters apply only to this subscription and don't show up in the library.
              </Hint>
            ) : (
              <div className="border border-border rounded-[10px] overflow-hidden bg-bg">
                {inlineFilters.map((row, i) => (
                  <FilterRow
                    key={row.clientKey}
                    filter={{
                      id: i,
                      ruleType: row.ruleType,
                      params: row.params,
                      enabled: row.enabled,
                    }}
                    onToggle={() => toggleInline(i)}
                    onEdit={() => startEditInline(i)}
                    onDelete={() => removeInline(i)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// `crypto.randomUUID()` is widely supported in modern browsers and Vitest's
// jsdom; fall back so unit tests on older runtimes don't blow up.
function cryptoUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inline-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function LibCheckbox({
  filter,
  selected,
  onToggle,
}: {
  filter: LibraryFilterDto;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        selected
          ? 'bg-accent-soft border border-accent'
          : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded grid place-items-center border-[1.5px] flex-shrink-0',
          selected ? 'border-accent bg-accent' : 'border-border-strong',
        )}
      >
        {selected && <Check size={11} strokeWidth={3} className="text-accent-fg" />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">{filter.name}</div>
        <div className="font-mono text-[11px] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
          {describeFilter({ ruleType: filter.ruleType, params: filter.params })}
        </div>
      </div>
    </button>
  );
}

function ResolvedCard({
  resolving,
  resolved,
  error,
}: {
  resolving: boolean;
  resolved: { sourceChatId: string; sourceTitle: string; handle: string | null } | null | undefined;
  error: Error | null;
}) {
  if (error && !resolving) {
    const msg =
      error instanceof ApiError
        ? (error.body?.error.message ?? 'Could not resolve channel')
        : 'Could not resolve channel';
    return (
      <div className="flex items-center gap-3 p-3 rounded border border-danger/40 bg-danger-soft text-danger text-[12.5px]">
        <AlertTriangle size={14} />
        <span>{msg}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-3 rounded border border-border bg-surface">
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-soft text-accent border border-accent/30 flex-shrink-0">
        {resolving ? <Spinner size={16} /> : <Check size={16} strokeWidth={2.5} />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        {resolving || !resolved ? (
          <>
            <span className="skeleton h-3 w-32" />
            <span className="skeleton h-2.5 w-24 mt-1" />
          </>
        ) : (
          <>
            <div className="text-[14px] font-medium tracking-tight">{resolved.sourceTitle}</div>
            <div className="flex gap-1.5 text-[11px] text-text-muted">
              <span className="font-mono">{resolved.handle ?? '—'}</span>
              <span className="text-text-faint">·</span>
              <span className="font-mono">{resolved.sourceChatId}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DestRadio({
  destination,
  selected,
  onSelect,
}: {
  destination: DestinationDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        selected
          ? 'bg-accent-soft border border-accent'
          : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded-full border-[1.5px] grid place-items-center flex-shrink-0',
          selected ? 'border-accent bg-accent' : 'border-border-strong',
        )}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-accent-fg" />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">{destination.name}</div>
        <div className="font-mono text-[11px] text-text-muted">{destination.chatId}</div>
      </div>
    </button>
  );
}
