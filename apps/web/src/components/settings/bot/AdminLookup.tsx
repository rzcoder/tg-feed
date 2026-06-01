/**
 * Admin allowlist lookup: a debounced search that resolves a `@username` /
 * t.me link / numeric id to a Telegram user and offers it for adding to the
 * bot's admin set. Self-contained — owns its own query state and resolve
 * mutation; the resolved entry is handed back to the parent via `onAdd`.
 */
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { BotAdmin } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResolveCard } from '@/components/domain/ResolveCard';
import { useDebouncedResolve } from '@/hooks/useDebouncedResolve';
import { useResolveBotAdmin } from '@/hooks/useBotConfig';
import { adminLabel } from './utils';

export interface AdminLookupProps {
  existingIds: Set<string>;
  disabled: boolean;
  onAdd: (admin: BotAdmin) => void;
}

export function AdminLookup({ existingIds, disabled, onAdd }: AdminLookupProps) {
  const [query, setQuery] = useState('');
  const resolve = useResolveBotAdmin();
  const { mutate: resolveMutate, reset: resolveReset } = resolve;

  useDebouncedResolve({
    value: query,
    enabled: !disabled,
    mutate: resolveMutate,
    reset: resolveReset,
    minLength: 4,
  });

  const resolved = resolve.data ?? null;
  const already = resolved ? existingIds.has(resolved.id) : false;

  const add = () => {
    if (!resolved || already) return;
    onAdd(resolved);
    setQuery('');
    resolveReset();
  };

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="@username or numeric id"
            monospace
            disabled={disabled}
            className="pl-9"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="h-[42px]"
          disabled={disabled || !resolved || already}
          onClick={add}
        >
          <Plus size={14} /> Add
        </Button>
      </div>

      {(resolve.isPending || resolved || resolve.error) && (
        <div className="mt-2">
          <ResolveCard
            resolving={resolve.isPending}
            resolved={
              resolved
                ? {
                    title: adminLabel(resolved),
                    handle: resolved.username ? `@${resolved.username}` : null,
                    chatId: resolved.id,
                  }
                : null
            }
            error={resolve.error}
            errorFallback="Could not resolve user"
          />
        </div>
      )}
    </div>
  );
}
