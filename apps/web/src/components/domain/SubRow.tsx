import { ChevronRight, Filter, Lock, Pencil, Send, ShieldAlert, Slash, Trash } from 'lucide-react';
import type { SubscriptionDto } from '@tg-feed/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EntityIcon } from '@/components/domain/EntityIcon';

export function SubRow({
  sub,
  expanded,
  onTap,
}: {
  sub: SubscriptionDto;
  expanded: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'w-full flex items-center gap-2.5 px-4.5 py-3 text-left bg-bg border-b border-border min-h-[60px]',
        'transition-colors',
        expanded && 'bg-bg-2 border-b-0',
      )}
    >
      <EntityIcon
        iconDataUrl={sub.iconDataUrl}
        fallback="rss"
        variant={expanded ? 'active' : 'default'}
      />
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[14.5px] font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
          {sub.sourceTitle}
        </div>
        <SubMeta sub={sub} />
      </div>
      <ChevronRight
        size={16}
        className={cn('text-text-faint transition-transform duration-150', expanded && 'rotate-90')}
      />
    </button>
  );
}

function SubMeta({ sub }: { sub: SubscriptionDto }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-text-muted flex-wrap">
      <span className="font-mono text-[11px]">{sub.handle ?? sub.sourceChatId.slice(-8)}</span>
      <span className="text-text-faint">·</span>
      {sub.destinationName ? (
        <span className="inline-flex items-center gap-1">
          <Send size={10} />
          {sub.destinationName}
          {sub.destinationAccessStatus === 'no_access' && (
            <span
              title="Userbot can't post to this destination — check it has been added to the chat."
              aria-label="no destination access"
              className="inline-flex"
            >
              <Lock size={10} className="text-danger" />
            </span>
          )}
        </span>
      ) : (
        <NoDestinationBadge />
      )}
      {sub.filterCount > 0 && (
        <>
          <span className="text-text-faint">·</span>
          <span>
            {sub.filterCount} filter{sub.filterCount === 1 ? '' : 's'}
          </span>
        </>
      )}
      {sub.forwardingRestrictedAt !== null && <NoForwardsBadge at={sub.forwardingRestrictedAt} />}
      {sub.sourceAccessStatus === 'no_access' && <NoAccessBadge />}
    </div>
  );
}

function NoForwardsBadge({ at }: { at: string }) {
  // Telegram returns CHAT_FORWARDS_RESTRICTED when the source channel has
  // "Restrict Saving Content" enabled. The forwarder stamps this timestamp;
  // it stays set until a forward succeeds again. Surfacing it inline tells
  // the operator their messages aren't reaching the destination.
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-warning-soft text-warning border border-warning/30"
      title={`Source channel rejected forwarding at ${new Date(at).toLocaleString()} — enable "Allow forwarding" in the channel or remove this subscription`}
    >
      <ShieldAlert size={10} />
      noforwards
    </span>
  );
}

function NoDestinationBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-warning-soft text-warning border border-warning/30"
      title="No destination attached — this subscription is saved but won't forward. Edit it to pick a destination."
    >
      <Slash size={10} />
      no destination
    </span>
  );
}

function NoAccessBadge() {
  // Set when the userbot couldn't auto-join on subscription create or when
  // the daily access sweep found `getEntity` failing for this source. Both
  // mean we won't see new messages from this channel until the operator
  // re-joins it from a Telegram client.
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-danger-soft text-danger border border-danger/30"
      title="Userbot is not a member of this channel or lost access. Re-join it from Telegram; status will refresh on the next daily sweep or after a server restart."
    >
      <Lock size={10} />
      no access
    </span>
  );
}

export function ExpandedSubActions({
  sub,
  onEdit,
  onViewFilters,
  onDelete,
}: {
  sub: SubscriptionDto;
  onEdit: () => void;
  onViewFilters: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-bg-2 border-b border-border px-4.5 pb-3.5">
      <div className="flex gap-2 pt-0.5 pb-3">
        <StatChip label="Source" value={sub.sourceChatId.slice(-8)} mono />
        <StatChip label="Destination" value={sub.destinationName ?? '—'} />
        <StatChip label="Forwarded" value={String(sub.forwardedCount)} mono />
      </div>

      <div className="flex gap-2 mt-1">
        <Button variant="secondary" size="sm" className="flex-1" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={onViewFilters}>
          <Filter size={13} /> Filters
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}

function StatChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col flex-1 min-w-0 px-2.5 py-2 bg-surface border border-border rounded-lg gap-px">
      <span className="text-[10px] font-semibold tracking-wide uppercase text-text-faint">
        {label}
      </span>
      <span
        className={cn(
          'text-[12.5px] font-medium text-text whitespace-nowrap overflow-hidden text-ellipsis',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}
