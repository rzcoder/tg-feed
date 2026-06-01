import { useEffect, useState } from 'react';
import type { DestinationDto } from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ResolveCard } from '@/components/domain/ResolveCard';
import { useForumTopics, useResolveDestination } from '@/hooks/useDestinations';
import { useDebouncedResolve } from '@/hooks/useDebouncedResolve';

// Telegram's General topic has the reserved top_msg_id 1. We represent it as
// the null/no-topic choice so a forum's General and a normal chat share the
// "no explicit topic" code path; the API's General entry is filtered out.
const GENERAL_TOPIC_ID = '1';

export interface DestSheetSubmit {
  name: string;
  /** Set when the resolver returned a chatId (any input form except not-yet-joined private invite). */
  chatId: string | null;
  /** Set when the input was a `t.me/+HASH` link the userbot hasn't joined — server joins on add. */
  inviteHash: string | null;
  note?: string;
  /** Selected forum topic, or null for the General topic / a non-forum chat. */
  topicId: string | null;
  topicTitle: string | null;
}

export interface DestSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  initial?: DestinationDto | null;
  onClose: () => void;
  onSubmit: (data: DestSheetSubmit) => void;
  submitting?: boolean;
}

export function DestSheet({ open, mode, initial, onClose, onSubmit, submitting }: DestSheetProps) {
  const isEdit = mode === 'edit';
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  // Track manual edits so we can auto-fill from a resolved title without
  // clobbering anything the user typed first.
  const [nameTouched, setNameTouched] = useState(false);
  const [note, setNote] = useState('');
  // Selected forum topic; null == General / no topic. `topicTitle` is cached
  // alongside so we can persist it without re-deriving from the topics list.
  const [topicId, setTopicId] = useState<string | null>(null);
  const [topicTitle, setTopicTitle] = useState<string | null>(null);

  const {
    mutate: mutateResolve,
    reset: resetResolve,
    data: resolveData,
    isPending: resolvePending,
    error: resolveErrorRaw,
  } = useResolveDestination();

  // Reset on open / mode change.
  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setLink('');
      setName(initial.name);
      setNote(initial.note ?? '');
      setNameTouched(true);
      setTopicId(initial.topicId);
      setTopicTitle(initial.topicTitle);
      resetResolve();
    } else {
      setLink('');
      setName('');
      setNote('');
      setNameTouched(false);
      setTopicId(null);
      setTopicTitle(null);
      resetResolve();
    }
  }, [open, initial, isEdit, resetResolve]);

  // Debounce resolve in add mode.
  useDebouncedResolve({
    value: link,
    enabled: !isEdit,
    mutate: mutateResolve,
    reset: resetResolve,
  });

  useEffect(() => {
    if (isEdit) return;
    if (nameTouched) return;
    if (!resolveData) return;
    setName(resolveData.title);
  }, [resolveData, isEdit, nameTouched]);

  const resolved = !isEdit ? resolveData : null;
  const resolving = !isEdit && resolvePending;
  const resolveError = !isEdit ? resolveErrorRaw : null;

  // Topic picker. Fetch the chat's topics whenever we have a resolved (add
  // mode) or stored (edit mode) chat id, and show the picker only when the
  // lister reports a forum. Driving `isForum` off the lister — which calls
  // channels.GetForumTopics — is authoritative, unlike the resolve-time
  // `entity.forum` hint which gramjs doesn't reliably populate.
  const topicChatId = isEdit ? (initial?.chatId ?? null) : (resolved?.chatId ?? null);
  const topicsQuery = useForumTopics(topicChatId, !!topicChatId);
  const isForum = topicsQuery.data?.isForum ?? false;

  // Topics belong to a specific forum, so clear any stale pick when the
  // resolved chat changes in add mode.
  useEffect(() => {
    if (isEdit) return;
    setTopicId(null);
    setTopicTitle(null);
  }, [resolved?.chatId, isEdit]);

  // General (top_msg_id 1) is the null choice, so drop it from the explicit list.
  const pickableTopics = (topicsQuery.data?.topics ?? []).filter((t) => t.id !== GENERAL_TOPIC_ID);
  const selectedKnown = topicId === null || pickableTopics.some((t) => t.id === topicId);

  const pickTopic = (value: string) => {
    if (value === '') {
      setTopicId(null);
      setTopicTitle(null);
      return;
    }
    const found = pickableTopics.find((t) => t.id === value);
    setTopicId(value);
    // Keep the cached title when re-selecting a topic that's no longer listed.
    setTopicTitle(found?.title ?? topicTitle);
  };

  const canSave = (() => {
    if (submitting) return false;
    if (!name.trim()) return false;
    if (isEdit) return true;
    return !!resolved && !resolving;
  })();

  const handleSubmit = () => {
    if (!canSave) return;
    const trimmedNote = note.trim();
    if (isEdit && initial) {
      onSubmit({
        name: name.trim(),
        chatId: initial.chatId,
        inviteHash: null,
        topicId,
        topicTitle,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      return;
    }
    if (!resolved) return;
    onSubmit({
      name: name.trim(),
      chatId: resolved.chatId,
      inviteHash: resolved.inviteHash,
      topicId,
      topicTitle,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit ? 'Edit destination' : 'Add destination'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canSave} onClick={handleSubmit}>
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!isEdit && (
          <div>
            <Label htmlFor="dest-link">Telegram chat</Label>
            <Input
              id="dest-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="invite link, t.me link, @username, or chat id"
              autoFocus
              monospace
            />
            <Hint>
              Paste any Telegram link (including <span className="font-mono">t.me/+invite</span>),
              an <span className="font-mono">@username</span>, or a numeric chat id.
            </Hint>
          </div>
        )}

        {!isEdit && (resolving || resolved || resolveError) && (
          <ResolveCard
            resolving={resolving}
            resolved={
              resolved
                ? { title: resolved.title, handle: resolved.handle, chatId: resolved.chatId }
                : resolved
            }
            error={resolveError}
            errorFallback="Could not resolve chat"
          />
        )}

        {isEdit && initial && (
          <div>
            <Label>Chat id</Label>
            <div className="font-mono text-[13px] px-3 py-2 rounded border border-border bg-surface text-text-muted">
              {initial.chatId}
            </div>
            <Hint>Chat id can't be changed — delete and re-add to point at a different chat.</Hint>
          </div>
        )}

        {isForum && (
          <div>
            <Label htmlFor="dest-topic">Topic</Label>
            <select
              id="dest-topic"
              value={topicId ?? ''}
              onChange={(e) => pickTopic(e.target.value)}
              className={cn(
                'w-full h-[42px] px-3.5 bg-surface text-text border border-border rounded-[var(--radius)]',
                'text-[15px] outline-none transition-[border-color,box-shadow] duration-100',
                'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]',
              )}
            >
              <option value="">General (no topic)</option>
              {!selectedKnown && topicId !== null && (
                <option value={topicId}>{topicTitle ?? `Topic ${topicId}`}</option>
              )}
              {pickableTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <Hint>Forum group — choose which topic messages are forwarded into.</Hint>
          </div>
        )}

        <div>
          <Label htmlFor="dest-name">Name</Label>
          <Input
            id="dest-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="ops-feed"
          />
          <Hint>Short label you'll see in subscriptions.</Hint>
        </div>

        <div>
          <Label htmlFor="dest-note">
            Note <span className="text-text-faint font-normal">(optional)</span>
          </Label>
          <Input
            id="dest-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Primary ops channel"
          />
        </div>
      </div>
    </Sheet>
  );
}
