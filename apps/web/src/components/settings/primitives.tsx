/**
 * Shared building blocks for the Settings page cards, ported from the design
 * direction (project/styles.css + screen-settings.jsx) onto our Tailwind
 * tokens. Every Settings panel is a self-titled card: a `CardHeader` (icon
 * badge + title + optional status pill / toggle), a body, and an optional
 * `CardFooter` (Reset / Save). Inside the body, `PanelSection` groups related
 * fields under an uppercase label, and `FieldHead` pairs a field label with a
 * `SourceBadge` (database vs .env).
 */
import type { ReactNode } from 'react';
import { ChevronDown, Lock, Zap } from 'lucide-react';
import type { BotConfigSource } from '@tg-feed/shared';
import { cn } from '@/lib/cn';

export interface SettingsCardProps {
  children: ReactNode;
  className?: string;
}

export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-border bg-surface overflow-hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  icon: ReactNode;
  title: ReactNode;
  right?: ReactNode;
}

/** Card header: icon badge + title on the left, an optional pill/toggle on the right. */
export function CardHeader({ icon, title, right }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-4 py-3 border-b border-border bg-bg-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="grid place-items-center w-[26px] h-[26px] rounded-[7px] bg-surface-2 border border-border text-text-2 flex-shrink-0">
          {icon}
        </span>
        <span className="text-[14px] font-semibold tracking-tight truncate">{title}</span>
      </div>
      {right}
    </div>
  );
}

export interface CardFooterProps {
  left?: ReactNode;
  children: ReactNode;
}

/** Card footer on a tinted bar. `left` is pinned to the start (e.g. a danger reset). */
export function CardFooter({ left, children }: CardFooterProps) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-bg-2">
      {left && <div className="mr-auto">{left}</div>}
      {children}
    </div>
  );
}

export interface PanelSectionProps {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}

/** A labelled group within a card body; `right` sits opposite the label (e.g. a toggle). */
export function PanelSection({ label, right, children }: PanelSectionProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10.5px] font-semibold tracking-wide uppercase text-text-faint">
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

export interface FieldHeadProps {
  label: string;
  source?: BotConfigSource | null;
}

/** Field label paired with its source badge. */
export function FieldHead({ label, source }: FieldHeadProps) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-xs font-medium text-text-2 tracking-[0.005em]">{label}</span>
      {source !== undefined && <SourceBadge source={source} />}
    </div>
  );
}

export interface SourceBadgeProps {
  source: BotConfigSource | null;
}

/** Small uppercase pill showing where a value resolves from: database / .env / not set. */
export function SourceBadge({ source }: SourceBadgeProps) {
  if (!source) return <span className="text-[10.5px] text-text-faint">not set</span>;
  const isDb = source === 'db';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-semibold uppercase tracking-[0.04em]',
        isDb ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-text-faint',
      )}
    >
      {isDb ? <Zap size={9} strokeWidth={2.4} /> : <Lock size={9} strokeWidth={2.4} />}
      {isDb ? 'database' : '.env'}
    </span>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Omit when the switch is labelled by adjacent text. */
  label?: string;
  disabled?: boolean;
}

/** Accessible on/off switch matching the design's `.toggle`. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      {...(label !== undefined ? { 'aria-label': label } : {})}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-[38px] h-[22px] rounded-full border flex-shrink-0 transition-colors duration-150',
        'disabled:opacity-55 disabled:cursor-not-allowed',
        checked ? 'bg-accent border-accent' : 'bg-surface-3 border-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-150',
          checked ? 'translate-x-4 bg-accent-fg' : 'translate-x-0 bg-text',
        )}
      />
    </button>
  );
}

type PillTone = 'live' | 'warn' | 'down' | 'neutral';

const PILL_TONES: Record<PillTone, string> = {
  live: 'bg-success-soft text-success border-success/40',
  warn: 'bg-warning-soft text-warning border-warning/40',
  down: 'bg-danger-soft text-danger border-danger/40',
  neutral: 'bg-surface-2 text-text-2 border-border',
};

const DOT_TONES: Record<PillTone, string> = {
  live: 'bg-success pulse-dot',
  warn: 'bg-warning',
  down: 'bg-danger',
  neutral: 'bg-text-faint',
};

export interface StatusPillProps {
  tone: PillTone;
  children: ReactNode;
}

/** Rounded status pill with a leading dot, matching the design's `.pill`. */
export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border text-[11.5px] font-medium tracking-[0.01em] tabular-nums',
        PILL_TONES[tone],
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', DOT_TONES[tone])} />
      {children}
    </span>
  );
}

export interface InlineSelectProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Compact styled native <select> for the inline-sentence digest config. */
export function InlineSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: InlineSelectProps<T>) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'appearance-none h-[30px] pl-2.5 pr-7 rounded-[7px] bg-surface-2 border border-border',
          'text-[13px] font-semibold text-text tracking-[-0.005em] outline-none',
          'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]',
          'disabled:opacity-55',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
      />
    </span>
  );
}
