import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { SectionHeader } from '@/components/domain/SectionHeader';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { cn } from '@/lib/cn';

const DELAY_MIN = 1000;
const DELAY_MAX = 20000;
const DELAY_STEP = 500;
const SPAM_THRESHOLD = 4000;

export function SettingsPage() {
  const { data, isPending } = useSettings();
  const { data: systemStatus } = useSystemStatus();
  const updateMut = useUpdateSettings();
  const toast = useToast();
  const tg = systemStatus?.telegram;

  const [draft, setDraft] = useState<number>(8000);
  useEffect(() => {
    if (data?.delayMs !== undefined) setDraft(data.delayMs);
  }, [data?.delayMs]);

  const dirty = data && draft !== data.delayMs;
  const warning = draft < SPAM_THRESHOLD;

  const save = () => {
    updateMut.mutate(
      { delayMs: draft },
      {
        onSuccess: () => toast.show('Settings saved'),
        onError: () => toast.show('Failed to save'),
      },
    );
  };

  if (isPending) {
    return (
      <div className="grid place-items-center flex-1 text-text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SectionHeader title="Settings" />

      <div className="scroll flex-1 min-h-0 px-4.5 pb-6">
        <SectionLabel>Connection</SectionLabel>
        {tg?.connected ? (
          <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 flex items-center gap-2.5">
            <span className="inline-block w-2 h-2 rounded-full bg-success" aria-hidden />
            <span className="text-[13px]">Telegram connected</span>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-[var(--radius)] border border-warning/40 bg-warning-soft text-warning p-3.5 flex items-start gap-2.5"
          >
            <AlertTriangle size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-[13px] font-medium">Telegram disconnected</span>
              <span className="text-[12px] leading-relaxed break-words">
                {tg?.reason ?? 'Telegram client is not available.'}
              </span>
              <span className="text-[11.5px] opacity-80">
                Subscribing and forwarding are unavailable until this is resolved.
              </span>
            </div>
          </div>
        )}

        <SectionLabel className="mt-3">Forwarding</SectionLabel>
        <div className="rounded-[var(--radius)] border border-border bg-surface p-4">
          <Label htmlFor="settings-delay">Global forward delay</Label>
          <div className="relative">
            <Input
              id="settings-delay"
              type="number"
              inputMode="numeric"
              value={String(draft)}
              onChange={(e) => setDraft(parseInt(e.target.value, 10) || 0)}
              monospace
              style={{ paddingRight: 48, fontSize: 16 }}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-text-muted pointer-events-none">
              ms
            </span>
          </div>
          <Hint>5000–15000 typical. Lower may trigger Telegram's spam classifier.</Hint>

          <div className="mt-3.5">
            <input
              type="range"
              min={DELAY_MIN}
              max={DELAY_MAX}
              step={DELAY_STEP}
              value={draft}
              onChange={(e) => setDraft(parseInt(e.target.value, 10))}
              className="w-full"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Forward delay slider"
            />
            <div className="flex justify-between text-[10.5px] text-text-faint mt-0.5">
              <span>1s</span>
              <span>safe range</span>
              <span>20s</span>
            </div>
          </div>

          {warning && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning-soft text-warning border border-warning/40 text-[12px] leading-relaxed"
            >
              <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
              <span>Below {SPAM_THRESHOLD}ms is likely to trigger Telegram's spam classifier.</span>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-3.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || updateMut.isPending}
              onClick={() => data && setDraft(data.delayMs)}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || updateMut.isPending}
              onClick={save}
            >
              {updateMut.isPending ? <Spinner size={14} /> : <Check size={14} strokeWidth={2.5} />}
              {updateMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <SectionLabel className="mt-3" suffix="soon">
          Authentication
        </SectionLabel>
        <DisabledCard
          title="Change password"
          description="Rotate the operator password."
          actionLabel="Coming"
        />

        <SectionLabel className="mt-3" suffix="soon">
          Retention
        </SectionLabel>
        <DisabledCard
          title="Activity log retention"
          description="How long to keep historical events."
          rightText="30 days"
        />
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  suffix,
  className,
}: {
  children: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-[10.5px] font-semibold tracking-wide uppercase text-text-faint py-2',
        className,
      )}
    >
      {children}
      {suffix && (
        <span className="ml-1.5 font-medium normal-case tracking-normal opacity-70">
          · {suffix}
        </span>
      )}
    </div>
  );
}

function DisabledCard({
  title,
  description,
  actionLabel,
  rightText,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  rightText?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 opacity-55">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex flex-col gap-px">
          <span className="text-[13px] font-medium">{title}</span>
          <span className="text-[11.5px] text-text-muted">{description}</span>
        </div>
        {actionLabel ? (
          <Button variant="secondary" size="sm" disabled>
            {actionLabel}
          </Button>
        ) : (
          <span className="text-[12px] text-text-muted">{rightText}</span>
        )}
      </div>
    </div>
  );
}
