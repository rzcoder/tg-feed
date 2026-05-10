/**
 * Per-rule param form. Matches the design's RuleForm — one input set per
 * rule type. Renders into the FilterSheet below the rule header card.
 *
 * The form is uncontrolled-ish: it reads + writes a single `params` object
 * whose shape is the rule's param schema. The parent owns the params
 * state. Validation happens at submit time via the shared zod schema.
 */
import { X } from 'lucide-react';
import { type KeyboardEvent } from 'react';
import type { FilterRuleType } from '@tg-feed/shared';
import { Input, Label, Hint } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface RuleFormProps {
  type: FilterRuleType;
  params: Record<string, unknown>;
  setParams: (next: Record<string, unknown>) => void;
  /** Library filters add a Name field at the top of the form. */
  showName?: boolean;
  name?: string;
  setName?: (next: string) => void;
}

export function RuleForm({ type, params, setParams, showName, name, setName }: RuleFormProps) {
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
        </>
      )}

      {type === 'min-length' && (
        <div>
          <Label htmlFor="filter-min">Minimum characters</Label>
          <Input
            id="filter-min"
            type="number"
            inputMode="numeric"
            value={String(params.min ?? 50)}
            onChange={(e) => setParams({ ...params, min: parseInt(e.target.value, 10) || 0 })}
            monospace
            autoFocus={!showName}
          />
          <Hint>Messages shorter than this are dropped.</Hint>
        </div>
      )}

      {type === 'has-media' && (
        <div className="flex flex-col gap-2">
          <Label>Match when…</Label>
          {[
            { v: true, l: 'Message has media' },
            { v: false, l: 'Message has NO media' },
          ].map((o) => {
            // params.required: true=must have, false=must NOT have. Treat
            // undefined as the default (true).
            const current = params.required !== false;
            const isThis = current === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setParams({ ...params, required: o.v })}
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
                {o.l}
              </button>
            );
          })}
        </div>
      )}

      {type === 'sender-allowlist' && (
        <SenderAllowlistInput params={params} setParams={setParams} />
      )}
    </>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium">{label}</span>
        {description && <span className="text-[11.5px] text-text-muted">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-[38px] h-[22px] rounded-full border transition-colors flex-shrink-0',
          value ? 'bg-accent border-accent' : 'bg-surface-3 border-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform',
            value ? 'bg-accent-fg translate-x-4' : 'bg-text',
          )}
        />
      </button>
    </div>
  );
}

function SenderAllowlistInput({
  params,
  setParams,
}: {
  params: Record<string, unknown>;
  setParams: (next: Record<string, unknown>) => void;
}) {
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
