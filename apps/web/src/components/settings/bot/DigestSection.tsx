/**
 * The "Stats digest" panel of the Bot settings card: an enable toggle plus an
 * inline-sentence schedule (frequency / day / time) and the captured browser
 * time zone. Presentational — drafts and setters are owned by the card. The
 * `botReady` flag drives the "add a token + admin first" warning; the time
 * zone is display-only (captured on save, no picker).
 */
import { AlertTriangle } from 'lucide-react';
import type { StatsDigestFrequency } from '@tg-feed/shared';
import { Hint } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { InlineSelect, PanelSection, Toggle } from '../primitives';

const FREQUENCIES: ReadonlyArray<{ value: StatsDigestFrequency; label: string }> = [
  { value: 'daily', label: 'daily' },
  { value: 'weekly', label: 'weekly' },
];

const DAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const;

export interface DigestSectionProps {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  frequency: StatsDigestFrequency;
  onFrequencyChange: (next: StatsDigestFrequency) => void;
  dayOfWeek: number;
  onDayOfWeekChange: (next: number) => void;
  time: string;
  onTimeChange: (next: string) => void;
  localTz: string;
  /** A token + at least one admin are present, so the digest can be delivered. */
  botReady: boolean;
}

export function DigestSection({
  enabled,
  onEnabledChange,
  frequency,
  onFrequencyChange,
  dayOfWeek,
  onDayOfWeekChange,
  time,
  onTimeChange,
  localTz,
  botReady,
}: DigestSectionProps) {
  return (
    <PanelSection
      label="Stats digest"
      right={<Toggle checked={enabled} onChange={onEnabledChange} label="Enable stats digest" />}
    >
      <div className="-mt-2">
        <Hint>Bot DMs admins a forwarded / filtered / error summary.</Hint>
      </div>

      {enabled && !botReady && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning-soft text-warning border border-warning/40 text-[12px] leading-relaxed">
          <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
          <span>Add a bot token + at least one admin above so the digest can be delivered.</span>
        </div>
      )}

      <div
        className={cn(
          'transition-opacity duration-150',
          enabled ? 'opacity-100' : 'opacity-40 pointer-events-none',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2 leading-[2]">
          <span>Send</span>
          <InlineSelect
            ariaLabel="Digest frequency"
            value={frequency}
            onChange={onFrequencyChange}
            options={FREQUENCIES}
          />
          {frequency === 'weekly' && (
            <>
              <span>on</span>
              <InlineSelect
                ariaLabel="Day of week"
                value={String(dayOfWeek)}
                onChange={(v) => onDayOfWeekChange(Number(v))}
                options={DAY_OPTIONS}
              />
            </>
          )}
          <span>at</span>
          <input
            type="time"
            aria-label="Digest time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="h-[30px] px-2.5 rounded-[7px] bg-surface-2 border border-border text-[13px] font-semibold text-text outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <span className="inline-flex items-center gap-1.5 h-[26px] px-2 rounded-full border border-border bg-surface-2 text-[11.5px] text-text-2">
            {localTz}
          </span>
        </div>
      </div>
    </PanelSection>
  );
}
