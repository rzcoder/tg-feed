import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Layout: bottom sheet on mobile, centered modal on desktop. Switched by
   * Tailwind breakpoint at `lg:` — same component, two looks.
   */
  children: ReactNode;
  footer?: ReactNode;
}

export function Sheet({ open, onOpenChange, title, description, children, footer }: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-fade-in',
            'data-[state=light]:bg-slate-900/30',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 bg-surface border border-border shadow-lg overflow-hidden flex flex-col outline-none',
            // Mobile: bottom sheet
            'left-0 right-0 bottom-0 max-h-[82%] rounded-t-2xl animate-slide-up',
            // Desktop (lg+): centered modal
            'lg:left-1/2 lg:right-auto lg:bottom-auto lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2',
            'lg:w-[460px] lg:max-h-[80vh] lg:rounded-[14px] lg:animate-fade-in',
          )}
          aria-describedby={description ? 'sheet-description' : undefined}
        >
          <div className="grid place-items-center pt-2 pb-1 lg:hidden">
            <span className="block w-8 h-1 rounded bg-border-strong" />
          </div>
          <div className="flex items-center justify-between px-4.5 pt-3 pb-3 border-b border-border">
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X size={16} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {description && (
            <DialogPrimitive.Description
              id="sheet-description"
              className="px-4.5 pt-2 text-[12px] text-text-muted"
            >
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="scroll flex-1 px-4.5 py-4 min-h-0">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 px-4.5 py-3 border-t border-border bg-bg-2">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
