import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  monospace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, monospace, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'w-full h-[42px] px-3.5 bg-surface text-text border border-border rounded-[var(--radius)]',
        'text-[15px] outline-none transition-[border-color,box-shadow] duration-100',
        'placeholder:text-text-faint',
        'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]',
        invalid && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]',
        monospace && 'font-mono text-[13.5px]',
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-medium text-text-2 block mb-1.5 tracking-[0.005em]', className)}
      {...props}
    />
  );
}

export function Hint({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-xs text-text-muted mt-1.5 leading-snug', className)} {...props} />
  );
}
