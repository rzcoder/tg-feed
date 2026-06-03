import { Rss, Send, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const FALLBACK_ICONS: Record<EntityIconFallback, LucideIcon> = {
  rss: Rss,
  send: Send,
};

const SIZE_CLASSES: Record<EntityIconSize, { box: string; iconPx: number }> = {
  md: { box: 'w-[30px] h-[30px] rounded-[7px]', iconPx: 13 },
  sm: { box: 'w-6 h-6 rounded-md', iconPx: 12 },
};

export type EntityIconFallback = 'rss' | 'send';
export type EntityIconSize = 'md' | 'sm';
export type EntityIconVariant = 'default' | 'active';

export interface EntityIconProps {
  iconDataUrl: string | null;
  fallback: EntityIconFallback;
  size?: EntityIconSize;
  // `active` paints the fallback container with accent colors; no effect when a photo is present.
  variant?: EntityIconVariant;
  className?: string;
}

export function EntityIcon({
  iconDataUrl,
  fallback,
  size = 'md',
  variant = 'default',
  className,
}: EntityIconProps): JSX.Element {
  const { box, iconPx } = SIZE_CLASSES[size];
  const FallbackIcon = FALLBACK_ICONS[fallback];

  if (iconDataUrl) {
    return (
      <span
        className={cn(
          'grid place-items-center overflow-hidden flex-shrink-0',
          box,
          'bg-surface-2 border border-border',
          className,
        )}
      >
        <img
          src={iconDataUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'grid place-items-center flex-shrink-0 transition-colors duration-100',
        box,
        variant === 'active'
          ? 'bg-accent text-accent-fg'
          : 'bg-surface-2 text-text-2 border border-border',
        className,
      )}
    >
      <FallbackIcon size={iconPx} />
    </span>
  );
}
