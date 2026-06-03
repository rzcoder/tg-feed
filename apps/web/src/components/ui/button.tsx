import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';

const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap',
    'font-medium tracking-tight transition-[background-color,border-color,transform]',
    'duration-100 active:scale-[0.98]',
    'disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg border border-accent hover:bg-accent-2',
        secondary: 'bg-surface-2 text-text border border-border hover:bg-surface-3',
        ghost:
          'bg-transparent text-text-2 border border-transparent hover:bg-surface-2 hover:text-text',
        danger:
          'bg-transparent text-danger border border-border hover:bg-danger-soft hover:border-danger',
      },
      size: {
        sm: 'h-8 px-2.5 text-[13px] rounded-lg',
        md: 'h-9 px-3.5 text-[14px] rounded-[var(--radius)]',
        lg: 'h-12 px-4.5 text-[15px] rounded-[var(--radius)]',
        icon: 'h-9 w-9 px-0 rounded-[var(--radius)]',
        'icon-sm': 'h-8 w-8 px-0 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  icon?: ReactNode;
  loading?: boolean;
  spinnerSize?: number;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    type = 'button',
    icon,
    loading,
    spinnerSize = 14,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    >
      {loading ? <Spinner size={spinnerSize} /> : icon}
      {children}
    </button>
  );
});
