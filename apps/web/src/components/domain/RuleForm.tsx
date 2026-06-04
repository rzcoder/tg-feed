import { X } from 'lucide-react';
import { type KeyboardEvent } from 'react';
import { filterRuleDefaultParams, type FilterMode, type FilterRuleType } from '@tg-feed/shared';
import { Input, Label, Hint } from '@/components/ui/input';
import { Toggle } from '@/components/settings/primitives';
import { cn } from '@/lib/cn';

interface RuleFormProps {
  type: FilterRuleType;
  params: Record<string, unknown>;
  setParams: (next: Record<string, unknown>) => void;
  // Shown only with setMode; else server default (include-only) applies.
  mode?: FilterMode;
  setMode?: (next: FilterMode) => void;
  showName?: boolean;
  name?: string;
  setName?: (next: string) => void;
}

export function RuleForm({
  type,
  params,
  setParams,
  mode,
  setMode,
  showName,
  name,
  setName,
}: RuleFormProps) {
  return (
    <>
      {showName && setName && (
        <div>
          <Label htmlFor="filter-name">Name</Label>
          <Input
            id="filter-name"
            value={name ?? ''}
            onChange={(e) => setName(e.target.value)}
            placeholder="No #реклама"
            autoFocus
          />
          <Hint>A short label so you can recognise this filter when attaching it.</Hint>
        </div>
      )}

      {mode !== undefined && setMode && <ModeToggle value={mode} onChange={setMode} />}

      {(type === 'text-contains' || type === 'text-excludes') && (
        <>
          <div>
            <Label htmlFor="filter-substring">Substring</Label>
            <Input
              id="filter-substring"
              value={(params.value as string) ?? ''}
              onChange={(e) => setParams({ ...params, value: e.target.value })}
              placeholder={type === 'text-contains' ? 'release' : '#реклама'}
              autoFocus={!showName}
            />
          </div>
          <ToggleRow
            label="Case-insensitive"
            description="On matches release, RELEASE, Release."
            value={params.caseInsensitive !== false}
            onChange={(v) => setParams({ ...params, caseInsensitive: v })}
          />
          <ToggleRow
            label="Also match link URLs"
            description="Search hidden hyperlink targets (and code-block tags), not just the visible text."
            value={params.includeEntities === true}
            onChange={(v) => setParams({ ...params, includeEntities: v })}
          />
        </>
      )}

      {type === 'text-regex' && (
        <>
          <div>
            <Label htmlFor="filter-pattern">Pattern</Label>
            <Input
              id="filter-pattern"
              value={(params.pattern as string) ?? ''}
              onChange={(e) => setParams({ ...params, pattern: e.target.value })}
              placeholder="^v?\d+\.\d+"
              monospace
              autoFocus={!showName}
            />
          </div>
          <div>
            <Label htmlFor="filter-flags">Flags</Label>
            <Input
              id="filter-flags"
              value={(params.flags as string) ?? ''}
              onChange={(e) => setParams({ ...params, flags: e.target.value })}
              placeholder="i"
              monospace
            />
          </div>
          <ToggleRow
            label="Also match link URLs"
            description="Run the pattern against hidden hyperlink targets (and code-block tags) too."
            value={params.includeEntities === true}
            onChange={(v) => setParams({ ...params, includeEntities: v })}
          />
        </>
      )}

      {type === 'min-length' && (
        <div>
          <Label htmlFor="filter-min">Minimum characters</Label>
          <Input
            id="filter-min"
            type="number"
            inputMode="numeric"
            value={String(params.min ?? filterRuleDefaultParams['min-length'].min)}
            onChange={(e) => setParams({ ...params, min: parseInt(e.target.value, 10) || 0 })}
            monospace
            autoFocus={!showName}
          />
          <Hint>Messages shorter than this are dropped.</Hint>
        </div>
      )}

      {type === 'has-media' && (
        <>
          <RadioList
            label="Match when…"
            options={[
              { value: 'yes', label: 'Message has media' },
              { value: 'no', label: 'Message has NO media' },
            ]}
            value={params.required !== false ? 'yes' : 'no'}
            onChange={(v) => {
              // "No media" can't carry a count comparison; drop a stale one so the draft stays valid.
              const next = { ...params };
              next.required = v === 'yes';
              if (v === 'no') {
                delete next.countOp;
                delete next.count;
              }
              setParams(next);
            }}
          />

          {params.required !== false && (
            <>
              <ToggleRow
                label="Filter by media count"
                description="An album counts as its number of items; a single media message counts as 1."
                value={params.countOp !== undefined}
                onChange={(v) => {
                  const next = { ...params };
                  if (v) {
                    next.countOp = (params.countOp as string) ?? 'gt';
                    next.count = (params.count as number) ?? 2;
                  } else {
                    delete next.countOp;
                    delete next.count;
                  }
                  setParams(next);
                }}
              />
              {params.countOp !== undefined && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SegmentedControl
                      options={[
                        { value: 'gt', label: 'More than' },
                        { value: 'lt', label: 'Fewer than' },
                      ]}
                      value={(params.countOp as string) ?? 'gt'}
                      onChange={(v) => setParams({ ...params, countOp: v })}
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      aria-label="Media count threshold"
                      value={params.count === undefined ? '' : String(params.count)}
                      onChange={(e) => {
                        // Allow a transient empty field (draft just goes invalid) instead of snapping to 1.
                        const raw = e.target.value.trim();
                        const next = { ...params };
                        if (raw === '') {
                          delete next.count;
                        } else {
                          const n = parseInt(raw, 10);
                          if (Number.isFinite(n)) next.count = n;
                        }
                        setParams(next);
                      }}
                      monospace
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {type === 'sender-allowlist' && (
        <SenderAllowlistInput params={params} setParams={setParams} />
      )}

      {type === 'link-prefix' && (
        <>
          <div>
            <Label htmlFor="filter-link">Link starts with</Label>
            <Input
              id="filter-link"
              value={(params.value as string) ?? ''}
              onChange={(e) => setParams({ ...params, value: e.target.value })}
              placeholder="t.me/  or  https://t.me/"
              monospace
              autoFocus={!showName}
            />
            <Hint>
              Include a protocol (https://) to require it; omit it to match any protocol. A leading
              www. is ignored.
            </Hint>
          </div>
          <RadioList
            label="Look in…"
            options={[
              { value: 'both', label: 'Anywhere' },
              { value: 'text', label: 'Visible message text' },
              { value: 'entity', label: 'Hidden hyperlink targets' },
            ]}
            value={(params.scope as string) ?? 'both'}
            onChange={(v) => setParams({ ...params, scope: v })}
          />
        </>
      )}
    </>
  );
}

interface ModeToggleProps {
  value: FilterMode;
  onChange: (next: FilterMode) => void;
}

function ModeToggle({ value, onChange }: ModeToggleProps) {
  const options = [
    { value: 'include', label: 'Include', hint: 'Forward only when this rule matches.' },
    { value: 'exclude', label: 'Exclude', hint: 'Drop the message when this rule matches.' },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="mb-0">Mode</Label>
      <SegmentedControl
        options={options}
        value={value}
        onChange={(v) => onChange(v as FilterMode)}
      />
      <Hint>{options.find((o) => o.value === value)?.hint}</Hint>
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

// Vertical single-select list with a radio dot (has-media presence, link-prefix scope).
function RadioList({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label !== undefined && <Label>{label}</Label>}
      {options.map((o) => {
        const isThis = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[13.5px]',
              isThis
                ? 'bg-accent-soft border border-accent'
                : 'bg-surface border border-border hover:bg-surface-2',
            )}
          >
            <span
              className={cn(
                'w-4 h-4 rounded-full border-[1.5px] flex-shrink-0',
                isThis ? 'border-accent bg-accent' : 'border-border-strong',
              )}
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Horizontal pill strip (mode toggle, media-count operator).
function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex border border-border rounded-lg overflow-hidden bg-bg">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 px-3 py-2 text-[12.5px] font-medium tracking-tight transition-colors',
              active ? 'bg-accent text-accent-fg' : 'bg-bg text-text-muted hover:bg-surface-2',
            )}
            aria-pressed={active}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center gap-2.5 justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium">{label}</span>
        {description && <span className="text-[11.5px] text-text-muted">{description}</span>}
      </div>
      <Toggle checked={value} onChange={onChange} />
    </div>
  );
}

interface SenderAllowlistInputProps {
  params: Record<string, unknown>;
  setParams: (next: Record<string, unknown>) => void;
}

function SenderAllowlistInput({ params, setParams }: SenderAllowlistInputProps) {
  const usernames = ((params.usernames as string[]) ?? []).slice();
  const onAdd = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const value = (e.target as HTMLInputElement).value.trim();
    if (!value) return;
    setParams({ ...params, usernames: [...usernames, value.replace(/^@+/, '')] });
    (e.target as HTMLInputElement).value = '';
  };
  return (
    <div>
      <Label>Allowed senders</Label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {usernames.map((u, i) => (
          <span
            key={`${u}-${i}`}
            className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[11.5px] bg-accent-soft text-accent border border-transparent"
          >
            @{u}
            <button
              type="button"
              onClick={() =>
                setParams({
                  ...params,
                  usernames: usernames.filter((_, j) => j !== i),
                })
              }
              className="flex items-center"
              aria-label={`Remove @${u}`}
            >
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
      </div>
      <Input placeholder="Type a username and press Enter" onKeyDown={onAdd} monospace />
      <Hint>Forward only when the sender is on this list.</Hint>
    </div>
  );
}
