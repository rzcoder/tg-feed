/**
 * Settings → Forwarding card.
 *
 * Global pipeline knobs stored in the 'global' app_settings row: the inter-send
 * throttle delay and the album-debounce window. Both are number input + range
 * slider; sub-spam-threshold delays surface a warning. Saved together via one
 * Reset / Save, sending only the changed knob.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { CardFooter, CardHeader, SettingsCard } from './primitives';

const DELAY_MIN = 1000;
const DELAY_MAX = 20000;
const DELAY_STEP = 500;
const SPAM_THRESHOLD = 4000;

const ALBUM_MIN = 500;
const ALBUM_MAX = 10000;
const ALBUM_STEP = 250;

export function ForwardingSection() {
  const { data, isPending } = useSettings();
  const updateMut = useUpdateSettings();
  const toast = useToast();

  const [draft, setDraft] = useState(8000);
  const [albumDraft, setAlbumDraft] = useState(2000);
  useEffect(() => {
    if (data?.delayMs !== undefined) setDraft(data.delayMs);
    if (data?.albumDebounceMs !== undefined) setAlbumDraft(data.albumDebounceMs);
  }, [data?.delayMs, data?.albumDebounceMs]);

  if (isPending || !data) {
    return (
      <SettingsCard className="p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Loading…</span>
      </SettingsCard>
    );
  }

  const delayDirty = draft !== data.delayMs;
  const albumDirty = albumDraft !== data.albumDebounceMs;
  const dirty = delayDirty || albumDirty;
  // A cleared field coerces to 0; block saving a non-positive value (the
  // server's .positive() schema rejects it) and flag the field instead.
  const delayValid = Number.isInteger(draft) && draft > 0;
  const albumValid = Number.isInteger(albumDraft) && albumDraft > 0;
  const canSave = dirty && delayValid && albumValid && !updateMut.isPending;
  const warning = delayValid && draft < SPAM_THRESHOLD;

  const save = () => {
    const body: { delayMs?: number; albumDebounceMs?: number } = {};
    if (delayDirty) body.delayMs = draft;
    if (albumDirty) body.albumDebounceMs = albumDraft;
    updateMut.mutate(body as { delayMs: number } | { albumDebounceMs: number }, {
      onSuccess: () => toast.show('Settings saved'),
      onError: () => toast.error('Failed to save'),
    });
  };

  return (
    <SettingsCard>
      <CardHeader icon={<Timer size={14} />} title="Forwarding" />

      <div className="p-4 flex flex-col gap-4">
        <div>
          <Label htmlFor="settings-delay">Global forward delay</Label>
          <div className="relative">
            <Input
              id="settings-delay"
              type="number"
              inputMode="numeric"
              value={String(draft)}
              onChange={(e) => setDraft(parseInt(e.target.value, 10) || 0)}
              invalid={!delayValid}
              monospace
              style={{ paddingRight: 48, fontSize: 16 }}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-text-muted pointer-events-none">
              ms
            </span>
          </div>
          <Hint>5000–15000 typical. Lower may trigger Telegram's spam classifier.</Hint>

          <div className="mt-3.5">
            <input
              type="range"
              min={DELAY_MIN}
              max={DELAY_MAX}
              step={DELAY_STEP}
              value={draft}
              onChange={(e) => setDraft(parseInt(e.target.value, 10))}
              className="w-full"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Forward delay slider"
            />
            <div className="flex justify-between text-[10.5px] text-text-faint mt-0.5">
              <span>1s</span>
              <span>safe range</span>
              <span>20s</span>
            </div>
          </div>

          {warning && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning-soft text-warning border border-warning/40 text-[12px] leading-relaxed"
            >
              <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
              <span>Below {SPAM_THRESHOLD}ms is likely to trigger Telegram's spam classifier.</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border">
          <Label htmlFor="settings-album">Album debounce window</Label>
          <div className="relative">
            <Input
              id="settings-album"
              type="number"
              inputMode="numeric"
              value={String(albumDraft)}
              onChange={(e) => setAlbumDraft(parseInt(e.target.value, 10) || 0)}
              invalid={!albumValid}
              monospace
              style={{ paddingRight: 48, fontSize: 16 }}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-text-muted pointer-events-none">
              ms
            </span>
          </div>
          <Hint>
            How long to wait for additional album members before forwarding. Raise on slow links if
            albums fragment; lower for snappier sends.
          </Hint>

          <div className="mt-3.5">
            <input
              type="range"
              min={ALBUM_MIN}
              max={ALBUM_MAX}
              step={ALBUM_STEP}
              value={albumDraft}
              onChange={(e) => setAlbumDraft(parseInt(e.target.value, 10))}
              className="w-full"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Album debounce slider"
            />
            <div className="flex justify-between text-[10.5px] text-text-faint mt-0.5">
              <span>0.5s</span>
              <span>2s typical</span>
              <span>10s</span>
            </div>
          </div>
        </div>
      </div>

      <CardFooter>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || updateMut.isPending}
          onClick={() => {
            setDraft(data.delayMs);
            setAlbumDraft(data.albumDebounceMs);
          }}
        >
          Reset
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Check size={14} strokeWidth={2.5} />}
          loading={updateMut.isPending}
          disabled={!canSave}
          onClick={save}
        >
          {updateMut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </SettingsCard>
  );
}
