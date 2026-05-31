import { Loader } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader size={size} className={cn('animate-spin', className)} />;
}
