import { Loader } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 18, className }: SpinnerProps) {
  return <Loader size={size} className={cn('animate-spin', className)} />;
}
