import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { DestinationDto } from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/api/client';
import { useResolveDestination } from '@/hooks/useDestinations';

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

  // Debounce resolve in add mode. Mirrors SubSheet.tsx — 600ms after the
  // last keystroke, skip if the input is too short to plausibly be valid.
  useEffect(() => {
    if (isEdit) return;
    const trimmed = link.trim();
    if (trimmed.length < 4) {
      resetResolve();
      return;
    }
    const t = setTimeout(() => {
      mutateResolve(trimmed);
    }, 600);
    return () => clearTimeout(t);
  }, [link, isEdit, mutateResolve, resetResolve]);

  // Auto-fill the Name field from the resolved title — only when the user
  // hasn't already typed something. Once they type, `nameTouched` flips
  // and we never overwrite again.
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
          <ResolvedCard resolving={resolving} resolved={resolved} error={resolveError} />
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

function ResolvedCard({
  resolving,
  resolved,
  error,
}: {
  resolving: boolean;
  resolved:
    | { chatId: string | null; title: string; handle: string | null; inviteHash: string | null }
    | null
    | undefined;
  error: Error | null;
}) {
  if (error && !resolving) {
    const msg =
      error instanceof ApiError
        ? (error.body?.error.message ?? 'Could not resolve chat')
        : 'Could not resolve chat';
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
