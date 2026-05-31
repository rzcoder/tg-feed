import { useEffect, useState } from 'react';
import type { DestinationDto } from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { ResolveCard } from '@/components/domain/ResolveCard';
import { useResolveDestination } from '@/hooks/useDestinations';
import { useDebouncedResolve } from '@/hooks/useDebouncedResolve';

export interface DestSheetSubmit {
  name: string;
  /** Set when the resolver returned a chatId (any input form except not-yet-joined private invite). */
  chatId: string | null;
  /** Set when the input was a `t.me/+HASH` link the userbot hasn't joined — server joins on add. */
  inviteHash: string | null;
  note?: string;
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
      resetResolve();
    } else {
      setLink('');
      setName('');
      setNote('');
      setNameTouched(false);
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
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      return;
    }
    if (!resolved) return;
    onSubmit({
      name: name.trim(),
      chatId: resolved.chatId,
      inviteHash: resolved.inviteHash,
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
