import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Logo glyph — the design's hand-rolled SVG path. Sized by parent.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 12h6l2-3 2 6 2-3h6" />
    </svg>
  );
}

function BadgeFrame({
  size,
  className,
  children,
}: {
  size: number;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'grid place-items-center bg-accent-soft text-accent border border-accent/35 rounded-[7px]',
        className,
      )}
      style={{
        width: size + 10,
        height: size + 10,
      }}
    >
      {children}
    </span>
  );
}

export function LogoBadge({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <BadgeFrame size={size} className={className}>
      <Logo size={size} />
    </BadgeFrame>
  );
}

/** Same badge frame as the brand logo, but renders an arbitrary lucide icon. */
export function IconBadge({
  icon: Icon,
  size = 16,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <BadgeFrame size={size} className={className}>
      <Icon size={size} aria-hidden />
    </BadgeFrame>
  );
}
