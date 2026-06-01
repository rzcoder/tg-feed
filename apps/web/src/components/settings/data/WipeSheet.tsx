/**
 * Wipe sheet — checkboxes per wipeable section, gated on a typed-in
 * confirmation phrase, then POSTs to /api/system/wipe. Destructive and
 * irreversible, so the confirm button stays disabled until the phrase matches.
 */
import { useState } from 'react';
import { Trash } from 'lucide-react';
import { WIPE_SECTIONS, type WipeSection } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { CheckboxCard } from '@/components/ui/checkbox-card';
import { Hint } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useDestinations } from '@/hooks/useDestinations';
import { useWipeData } from '@/hooks/useExportImport';
import { useLibraryFilters } from '@/hooks/useFilters';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { apiErrorMessage } from '@/api/client';
import { WIPE_CONFIRM_PHRASE, toggleInSet } from './shared';

const WIPE_LABELS: Record<WipeSection, string> = {
  subscriptions: 'Subscriptions',
  destinations: 'Destinations',
  libraryFilters: 'Library filters',
};

const WIPE_SIDE_EFFECTS: Record<WipeSection, string> = {
  subscriptions: 'Inline filters and library-filter attachments are dropped too.',
  destinations: 'Subscriptions referencing them will be detached and stop forwarding.',
  libraryFilters: 'Subscriptions using them as filters will simply lose those filters.',
};

interface WipeSheetProps {
  open: boolean;
  onClose: () => void;
}

export function WipeSheet({ open, onClose }: WipeSheetProps) {
  const toast = useToast();
  const wipeMut = useWipeData();
  const subs = useSubscriptions();
  const dests = useDestinations();
  const lib = useLibraryFilters();
  const [selected, setSelected] = useState<Set<WipeSection>>(new Set());
  const [confirmText, setConfirmText] = useState('');

  const counts: Record<WipeSection, number> = {
    subscriptions: subs.data?.length ?? 0,
    destinations: dests.data?.length ?? 0,
    libraryFilters: lib.data?.length ?? 0,
  };

  const totalSelected = Array.from(selected).reduce((acc, s) => acc + counts[s], 0);
  const phraseOk = confirmText.trim().toLowerCase() === WIPE_CONFIRM_PHRASE;

  const reset = () => {
    setSelected(new Set());
    setConfirmText('');
  };

  const closeSheet = () => {
    reset();
    onClose();
  };

  const toggle = (s: WipeSection) => setSelected((prev) => toggleInSet(prev, s));

  const onConfirm = () => {
    const sections = Array.from(selected);
    if (sections.length === 0 || !phraseOk) return;
    wipeMut.mutate(
      { sections },
      {
        onSuccess: (r) => {
          const total = sections.reduce((acc, s) => acc + r.deleted[s], 0);
          toast.show(`Deleted ${total} item${total === 1 ? '' : 's'}`);
          closeSheet();
        },
        onError: (err) => toast.error(apiErrorMessage(err, 'Delete failed')),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && closeSheet()}
      title="Delete data"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={closeSheet}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash size={14} />}
            loading={wipeMut.isPending}
            disabled={selected.size === 0 || !phraseOk || wipeMut.isPending}
            onClick={onConfirm}
          >
            {wipeMut.isPending
              ? 'Deleting…'
              : totalSelected > 0
                ? `Delete ${totalSelected} item${totalSelected === 1 ? '' : 's'}`
                : 'Delete'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Hint>
          Pick what to delete. Cannot be undone — export first if you might want this back.
        </Hint>

        <div className="flex flex-col gap-1.5">
          {WIPE_SECTIONS.map((s) => (
            <CheckboxCard
              key={s}
              tone="danger"
              label={
                <>
                  {WIPE_LABELS[s]}{' '}
                  <span className="text-text-faint font-normal">({counts[s]})</span>
                </>
              }
              description={WIPE_SIDE_EFFECTS[s]}
              descriptionClassName="leading-snug"
              checked={selected.has(s)}
              disabled={counts[s] === 0}
              onToggle={() => toggle(s)}
            />
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            <Hint>
              Type <strong className="text-danger font-mono">{WIPE_CONFIRM_PHRASE}</strong> to
              confirm:
            </Hint>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={WIPE_CONFIRM_PHRASE}
              className={cn(
                'h-[36px] px-3 rounded-lg border bg-bg text-[13px] font-mono outline-none transition-colors',
                phraseOk ? 'border-danger/40 text-danger' : 'border-border focus:border-danger/40',
              )}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}
