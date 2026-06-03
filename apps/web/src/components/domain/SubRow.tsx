import { memo, type ReactNode } from 'react';
import {
  ChevronRight,
  CornerDownRight,
  Filter,
  Lock,
  MessagesSquare,
  Pencil,
  Send,
  ShieldAlert,
  Slash,
  Trash,
} from 'lucide-react';
import type { DestinationDto, LibraryFilterDto, SubscriptionDto } from '@tg-feed/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EntityIcon } from '@/components/domain/EntityIcon';
import { FilterRow } from '@/components/domain/FilterRow';
import { useSubscriptionFilters } from '@/hooks/useFilters';

export interface SubRowProps {
  sub: SubscriptionDto;
  expanded: boolean;
  onToggle: (id: number) => void;
}

export const SubRow = memo(function SubRow({ sub, expanded, onToggle }: SubRowProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sub.id)}
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
});

interface SubMetaProps {
  sub: SubscriptionDto;
}

function SubMeta({ sub }: SubMetaProps) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-text-muted min-w-0">
      <span className="font-mono text-[11px] flex-shrink-0">
        {sub.handle ?? sub.sourceChatId.slice(-8)}
      </span>
      <span className="text-text-faint flex-shrink-0">·</span>
      {sub.destinationName ? (
        <span className="inline-flex items-center gap-1 min-w-0 max-w-[220px]">
          <Send size={10} className="flex-shrink-0" />
          <span className="truncate">{sub.destinationName}</span>
          {sub.destinationAccessStatus === 'no_access' && (
            <span
              title="Userbot can't post to this destination — check it has been added to the chat."
              aria-label="no destination access"
              className="inline-flex flex-shrink-0"
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
          <span className="text-text-faint flex-shrink-0">·</span>
          <span className="flex-shrink-0">
            {sub.filterCount} filter{sub.filterCount === 1 ? '' : 's'}
          </span>
        </>
      )}
      {sub.forwardingRestrictedAt !== null && <NoForwardsBadge at={sub.forwardingRestrictedAt} />}
      {sub.sourceAccessStatus === 'no_access' && <NoAccessBadge />}
    </div>
  );
}

interface NoForwardsBadgeProps {
  at: string;
}

function NoForwardsBadge({ at }: NoForwardsBadgeProps) {
  // Set on CHAT_FORWARDS_RESTRICTED; cleared when a forward next succeeds.
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
  // Userbot not a member: no new messages until it re-joins.
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

export interface ExpandedSubActionsProps {
  sub: SubscriptionDto;
  destinations: DestinationDto[];
  library: LibraryFilterDto[];
  onEdit: () => void;
  onPickDestination: () => void;
  onViewFilters: () => void;
  onDelete: () => void;
}

export function ExpandedSubActions({
  sub,
  destinations,
  library,
  onEdit,
  onPickDestination,
  onViewFilters,
  onDelete,
}: ExpandedSubActionsProps) {
  const filtersQuery = useSubscriptionFilters(sub.id);
  const destination =
    sub.destinationId !== null
      ? (destinations.find((d) => d.id === sub.destinationId) ?? null)
      : null;
  const own = filtersQuery.data ?? [];
  const attachedLibrary = (sub.libraryFilterIds ?? [])
    .map((id) => library.find((l) => l.id === id))
    .filter((l): l is LibraryFilterDto => Boolean(l));
  const loadedTotal = attachedLibrary.length + own.length;
  const isPending = filtersQuery.isPending;
  const showFilters = isPending ? sub.filterCount > 0 : loadedTotal > 0;
  const displayCount = isPending ? sub.filterCount : loadedTotal;

  return (
    <div className="bg-bg-2 border-b border-border px-4.5 pb-3.5 pt-1 flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Forwards to</SectionLabel>
        <DestinationCard
          destination={destination}
          accessStatus={sub.destinationAccessStatus}
          onClick={onPickDestination}
        />
      </section>

      {showFilters && (
        <section className="flex flex-col gap-1.5">
          <SectionLabel>
            Filters <span className="text-text-faint/70">· {displayCount}</span>
          </SectionLabel>
          {isPending ? (
            <div className="grid place-items-center py-4 bg-bg border border-border rounded-lg text-text-muted">
              <Spinner size={14} />
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden bg-bg [&>*:last-child]:border-b-0">
              {attachedLibrary.map((f) => (
                <FilterRow
                  key={`lib-${f.id}`}
                  filter={{
                    id: f.id,
                    ruleType: f.ruleType,
                    params: f.params,
                    name: f.name,
                    mode: f.mode,
                  }}
                  library
                />
              ))}
              {own.map((f) => (
                <FilterRow
                  key={`own-${f.id}`}
                  filter={{
                    id: f.id,
                    ruleType: f.ruleType,
                    params: f.params,
                    enabled: f.enabled,
                    mode: f.mode,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={onViewFilters}>
          <Filter size={13} /> Manage filters
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}

interface DestinationCardProps {
  destination: DestinationDto | null;
  accessStatus: SubscriptionDto['destinationAccessStatus'];
  onClick: () => void;
}

function DestinationCard({ destination, accessStatus, onClick }: DestinationCardProps) {
  if (!destination) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 px-2.5 py-2 bg-warning-soft border border-warning/30 rounded-lg text-left transition-colors hover:bg-warning-soft/70"
      >
        <CornerDownRight size={14} className="text-warning flex-shrink-0" />
        <Slash size={13} className="text-warning flex-shrink-0" />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[12.5px] font-medium tracking-tight text-warning truncate">
            No destination
          </span>
          <span className="text-[11px] text-text-muted truncate">
            Tap to choose where to forward.
          </span>
        </div>
        <Pencil size={13} className="text-warning/70 flex-shrink-0" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 bg-surface border border-border rounded-lg text-left transition-colors hover:bg-surface-2 hover:border-border-strong"
    >
      <CornerDownRight size={14} className="text-text-faint flex-shrink-0" />
      <EntityIcon iconDataUrl={destination.iconDataUrl} fallback="send" size="sm" />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[12.5px] font-medium tracking-tight truncate">
            {destination.name}
          </span>
          {destination.topicTitle && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-text-muted flex-shrink-0">
              <MessagesSquare size={10} />
              <span className="truncate max-w-[120px]">{destination.topicTitle}</span>
            </span>
          )}
          <span className="text-[10px] text-text-faint truncate">
            (Chat ID: <span className="font-mono">{destination.chatId}</span>)
          </span>
          {accessStatus === 'no_access' && (
            <span
              title="Userbot can't post to this destination — re-add it to the chat."
              aria-label="no destination access"
              className="inline-flex flex-shrink-0"
            >
              <Lock size={11} className="text-danger" />
            </span>
          )}
        </div>
        {destination.note && (
          <div className="text-[11px] text-text-faint italic truncate min-w-0">
            {destination.note}
          </div>
        )}
      </div>
      <Pencil size={13} className="text-text-faint flex-shrink-0" />
    </button>
  );
}

interface SectionLabelProps {
  children: ReactNode;
}

function SectionLabel({ children }: SectionLabelProps) {
  return (
    <div className="text-[10px] font-semibold tracking-wide uppercase text-text-faint">
      {children}
    </div>
  );
}
