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

export function LogoBadge({ size = 16, className }: { size?: number; className?: string }) {
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
      <Logo size={size} />
    </span>
  );
}
