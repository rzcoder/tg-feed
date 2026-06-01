import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import {
  inlineFilterInputSchema,
  type DestinationDto,
  type FilterMode,
  type FilterRuleType,
  type InlineFilterInput,
  type LibraryFilterDto,
  type SubscriptionDto,
} from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { CheckboxCard } from '@/components/ui/checkbox-card';
import { describeFilter } from '@/lib/describeFilter';
import { useResolveSubscription } from '@/hooks/useSubscriptions';
import { useSubscriptionFilters } from '@/hooks/useFilters';
import { useDebouncedResolve } from '@/hooks/useDebouncedResolve';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { ResolveCard } from '@/components/domain/ResolveCard';
import { DestinationOption, NoDestinationOption } from '@/components/domain/DestinationOption';
import { FilterRow } from '@/components/domain/FilterRow';
import { RuleForm } from '@/components/domain/RuleForm';
import { RuleListItem } from '@/components/domain/RuleListItem';

export interface InlineFilterDraft {
  /** Stable react key for the lifetime of an unsaved row. */
  clientKey: string;
  ruleType: FilterRuleType;
  params: Record<string, unknown>;
  enabled: boolean;
  mode: FilterMode;
}

export interface SubSheetSubmit {
  /**
   * Resolved chat id when known (public link / username / numeric id, or
   * already-member private invite). `null` only for `t.me/+HASH` invites
   * where the userbot isn't a member yet — in that case `inviteHash` is
   * non-null and the server joins on create to derive the id.
   */
  sourceChatId: string | null;
  inviteHash: string | null;
  sourceTitle: string;
  handle: string | null;
  /**
   * Null means "no destination" — subscription is created/saved in a
   * detached state and won't forward until the user attaches a destination.
   */
  destinationId: number | null;
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
  // Step-local draft buffer (shared with FilterSheet via useFilterDraft);
  // committed back into `inlineFilters` only on Save.
  const {
    ruleType: draftRule,
    params: draftParams,
    mode: draftMode,
    setParams: setDraftParams,
    setMode: setDraftMode,
    pickType,
    load: loadDraft,
    reset: resetDraft,
    valid: draftValid,
    parseParams,
  } = useFilterDraft();

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
    resetDraft();
  }, [open, isEdit, initial, destinations, resetResolve, resetDraft]);

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
        clientKey: newClientKey(),
        ruleType: f.ruleType,
        params: { ...f.params },
        enabled: f.enabled,
        mode: f.mode,
      })),
    );
    setSeeded(true);
  }, [open, isEdit, seeded, filtersQuery.data]);

  // Debounce resolve in add mode.
  useDebouncedResolve({
    value: link,
    enabled: !isEdit,
    mutate: mutateResolve,
    reset: resetResolve,
  });

  const resolved = !isEdit ? resolveData : null;
  const resolving = !isEdit && resolvePending;
  const resolveError = !isEdit ? resolveErrorRaw : null;

  const canSave = (() => {
    if (submitting) return false;
    if (isEdit) return true;
    return !!resolved && !resolving;
  })();

  const handleSubmit = () => {
    if (!canSave) return;
    // Validate each draft against the wire schema at the boundary rather than
    // casting. Inline-edited drafts are already parsed on commit, but ones
    // seeded from the server are re-checked here, so a schema drift fails
    // loudly instead of writing a malformed filter.
    const wireInline: InlineFilterInput[] = inlineFilters.map((d) =>
      inlineFilterInputSchema.parse({
        ruleType: d.ruleType,
        params: d.params,
        enabled: d.enabled,
        mode: d.mode,
      }),
    );
    if (isEdit && initial) {
      onSubmit({
        sourceChatId: initial.sourceChatId,
        inviteHash: null,
        sourceTitle: initial.sourceTitle,
        handle: initial.handle,
        destinationId: destId,
        libraryFilterIds: libIds,
        inlineFilters: wireInline,
      });
    } else if (resolved) {
      onSubmit({
        // For not-yet-joined private invites the resolve preview can't
        // know the chat id; the server joins via importInvite and derives
        // the id during create. Otherwise we forward the resolved id.
        sourceChatId: resolved.sourceChatId ?? null,
        inviteHash: resolved.inviteHash,
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
    resetDraft();
    setStep({ kind: 'pick-rule' });
  };
  const pickInlineRule = useCallback(
    (rt: FilterRuleType) => {
      pickType(rt);
      setStep({ kind: 'edit-params', index: -1 });
    },
    [pickType],
  );
  const startEditInline = (index: number) => {
    const row = inlineFilters[index]!;
    loadDraft(row.ruleType, row.params, row.mode);
    setStep({ kind: 'edit-params', index });
  };
  const commitDraft = () => {
    if (!draftRule || !draftValid) return;
    const validated = parseParams();
    setInlineFilters((prev) => {
      if (step.kind !== 'edit-params') return prev;
      if (step.index === -1) {
        return [
          ...prev,
          {
            clientKey: newClientKey(),
            ruleType: draftRule,
            params: validated,
            enabled: true,
            mode: draftMode,
          },
        ];
      }
      return prev.map((row, i) =>
        i === step.index
          ? { ...row, ruleType: draftRule, params: validated, mode: draftMode }
          : row,
      );
    });
    setStep({ kind: 'list' });
    resetDraft();
  };
  const cancelDraft = () => {
    setStep({ kind: 'list' });
    resetDraft();
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
            <RuleListItem key={rt} ruleType={rt} onSelect={pickInlineRule} />
          ))}
        </div>
      )}

      {step.kind === 'edit-params' && draftRule && (
        <div className="flex flex-col gap-3">
          <RuleForm
            type={draftRule}
            params={draftParams}
            setParams={setDraftParams}
            mode={draftMode}
            setMode={setDraftMode}
          />
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
              placeholder="@channel, t.me link, t.me/+invite, or chat id"
              autoFocus={!isEdit}
              monospace
            />
            {!isEdit && (
              <Hint>Paste any Telegram link, @username, invite link, or numeric chat id.</Hint>
            )}
            {isEdit && <Hint>Source channel can't be changed — delete and re-add to switch.</Hint>}
          </div>

          {!isEdit && (resolving || resolved || resolveError) && (
            <ResolveCard
              resolving={resolving}
              resolved={
                resolved
                  ? {
                      title: resolved.sourceTitle,
                      handle: resolved.handle,
                      chatId: resolved.sourceChatId,
                    }
                  : resolved
              }
              error={resolveError}
              errorFallback="Could not resolve channel"
            />
          )}

          <div>
            <Label>
              Destination <span className="text-text-faint font-normal">(optional)</span>
            </Label>
            <div className="flex flex-col gap-1.5">
              <NoDestinationOption selected={destId === null} onSelect={() => setDestId(null)} />
              {destinations.map((d) => (
                <DestinationOption
                  key={d.id}
                  destination={d}
                  selected={destId === d.id}
                  onSelect={setDestId}
                />
              ))}
              {destinations.length === 0 && (
                <Hint>
                  No destinations yet — add one in the Destinations tab to enable forwarding.
                </Hint>
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
                  <CheckboxCard
                    key={l.id}
                    label={l.name}
                    description={describeFilter({ ruleType: l.ruleType, params: l.params })}
                    descriptionClassName="font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                    checked={libIds.includes(l.id)}
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
                      mode: row.mode,
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

let inlineKeyCounter = 0;

// Stable React key for an unsaved inline-filter row. Prefers a UUID but falls
// back to a counter on insecure contexts (http:// LAN host, where
// crypto.randomUUID is undefined) — the key only needs to be unique in-sheet.
function newClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  inlineKeyCounter += 1;
  return `inline-${inlineKeyCounter}`;
}
