import { useEffect, useState } from 'react';
import type { DestinationDto } from '@tg-feed/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';

const CHAT_ID_RE = /^-?\d{6,}$/;

export interface DestSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  initial?: DestinationDto | null;
  onClose: () => void;
  onSubmit: (data: { name: string; chatId: string; note?: string }) => void;
  submitting?: boolean;
}

export function DestSheet({ open, mode, initial, onClose, onSubmit, submitting }: DestSheetProps) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setName(initial.name);
      setChatId(initial.chatId);
      setNote(initial.note ?? '');
    } else {
      setName('');
      setChatId('');
      setNote('');
    }
  }, [open, initial, isEdit]);

  const chatIdValid = CHAT_ID_RE.test(chatId.trim());
  const canSave = name.trim().length > 0 && chatIdValid && !submitting;

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
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() => {
              const trimmedNote = note.trim();
              onSubmit({
                name: name.trim(),
                chatId: chatId.trim(),
                ...(trimmedNote ? { note: trimmedNote } : {}),
              });
            }}
          >
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="dest-name">Name</Label>
          <Input
            id="dest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ops-feed"
            autoFocus
          />
          <Hint>Short label you'll see in subscriptions.</Hint>
        </div>
        <div>
          <Label htmlFor="dest-chat-id">Chat id</Label>
          <Input
            id="dest-chat-id"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1009374102931"
            invalid={chatId.length > 0 && !chatIdValid}
            monospace
          />
          <Hint>
            Numeric Telegram chat id (groups start with <span className="font-mono">-100</span>).
          </Hint>
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
