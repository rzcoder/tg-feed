import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[160px] rounded-[10px] border border-border-strong bg-surface-3 p-1',
          'shadow-lg outline-none animate-fade-in',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { selected?: boolean }
>(function DropdownMenuItem({ className, selected, children, ...props }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md text-[13px]',
        'cursor-default select-none outline-none',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-text',
        'text-text-2',
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {selected && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
    </DropdownPrimitive.Item>
  );
});
