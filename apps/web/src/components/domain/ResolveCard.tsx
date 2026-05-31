import { AlertTriangle, Check } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/api/client';

export interface ResolvePreview {
  title: string;
  handle: string | null;
  chatId: string | null;
}

export interface ResolveCardProps {
  resolving: boolean;
  resolved: ResolvePreview | null | undefined;
  error: Error | null;
  errorFallback: string;
}

export function ResolveCard({ resolving, resolved, error, errorFallback }: ResolveCardProps) {
  if (error && !resolving) {
    const msg =
      error instanceof ApiError ? (error.body?.error.message ?? errorFallback) : errorFallback;
    return (
      <div className="flex items-center gap-3 p-3 rounded border border-danger/40 bg-danger-soft text-danger text-[12.5px]">
        <AlertTriangle size={14} />
        <span>{msg}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-3 rounded border border-border bg-surface">
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-soft text-accent border border-accent/30 flex-shrink-0">
        {resolving ? <Spinner size={16} /> : <Check size={16} strokeWidth={2.5} />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        {resolving || !resolved ? (
          <>
            <span className="skeleton h-3 w-32" />
            <span className="skeleton h-2.5 w-24 mt-1" />
          </>
        ) : (
          <>
            <div className="text-[14px] font-medium tracking-tight">{resolved.title}</div>
            <div className="flex gap-1.5 text-[11px] text-text-muted">
              <span className="font-mono">{resolved.handle ?? '—'}</span>
              <span className="text-text-faint">·</span>
              {resolved.chatId ? (
                <span className="font-mono">{resolved.chatId}</span>
              ) : (
                <span>will join on add</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
