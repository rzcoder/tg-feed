import { useMemo, type ReactNode } from 'react';
import { User, X } from 'lucide-react';
import type { BotAdmin, BotConfigInfo } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Hint, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { FieldHead, PanelSection } from '../primitives';
import { AdminLookup } from './AdminLookup';
import { adminLabel } from './utils';

export interface ConnectionSectionProps {
  data: BotConfigInfo;
  busy: boolean;
  tokenDraft: string;
  onTokenChange: (value: string) => void;
  admins: BotAdmin[];
  onRemoveAdmin: (id: string) => void;
  onAddAdmin: (admin: BotAdmin) => void;
  currentTelegramUserId: string | null;
  urlDraft: string;
  onUrlChange: (value: string) => void;
  urlValid: boolean;
  /** "Reset to .env" affordance shown when the token resolves from the DB. */
  resetToEnvLink: ReactNode;
}

export function ConnectionSection({
  data,
  busy,
  tokenDraft,
  onTokenChange,
  admins,
  onRemoveAdmin,
  onAddAdmin,
  currentTelegramUserId,
  urlDraft,
  onUrlChange,
  urlValid,
  resetToEnvLink,
}: ConnectionSectionProps) {
  const existingAdminIds = useMemo(() => new Set(admins.map((a) => a.id)), [admins]);

  return (
    <PanelSection label="Connection">
      <div>
        <FieldHead label="Bot token" source={data.tokenSource} />
        <Input
          type="password"
          autoComplete="off"
          monospace
          placeholder={data.tokenConfigured ? 'Paste a new token to replace' : 'Paste bot token'}
          value={tokenDraft}
          onChange={(e) => onTokenChange(e.target.value)}
          disabled={!data.encryptionKeyConfigured || busy}
        />
        {data.encryptionKeyConfigured ? (
          <Hint>
            Encrypted at rest. Get one from{' '}
            <span className="font-mono text-text-2">@BotFather</span>.
            {data.tokenSource === 'db' && <> {resetToEnvLink}</>}
          </Hint>
        ) : (
          <Hint>
            Set <code className="font-mono">TG_SESSION_ENCRYPTION_KEY</code> in .env to store a bot
            token in the database.
          </Hint>
        )}
      </div>

      <div>
        <FieldHead label="Admins" source={data.adminsSource} />
        {admins.length === 0 ? (
          <p className="text-[12px] text-text-muted py-1">No admins yet — look one up below.</p>
        ) : (
          <div className="flex flex-col gap-1.5 mb-2">
            {admins.map((a) => {
              const isYou = currentTelegramUserId !== null && a.id === currentTelegramUserId;
              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex items-center gap-2.5 pl-3 pr-1.5 py-2 rounded-lg border',
                    isYou ? 'bg-accent-soft border-accent/40' : 'bg-surface-2 border-border',
                  )}
                >
                  <span className="grid place-items-center w-[26px] h-[26px] rounded-[7px] bg-surface-3 text-text-2 flex-shrink-0">
                    <User size={13} />
                  </span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[13px] font-medium truncate">
                        {adminLabel(a)}
                      </span>
                      {isYou && (
                        <span className="flex-shrink-0 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold leading-none text-accent-fg">
                          You
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10.5px] text-text-faint truncate">
                      {a.displayName && a.username ? `@${a.username} · ${a.id}` : a.id}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${adminLabel(a)}`}
                    disabled={busy}
                    onClick={() => onRemoveAdmin(a.id)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <AdminLookup existingIds={existingAdminIds} disabled={busy} onAdd={onAddAdmin} />
        <Hint>Look up a Telegram user to allow — @username, t.me link, or numeric id.</Hint>
      </div>

      <div>
        <FieldHead label="Public URL" source={data.publicUrlSource} />
        <Input
          type="url"
          inputMode="url"
          monospace
          placeholder="https://tg-feed.example.com"
          value={urlDraft}
          onChange={(e) => onUrlChange(e.target.value)}
          invalid={!urlValid}
          disabled={busy}
        />
        <Hint>
          {urlValid ? (
            'Where the web client is served. Must be https:// for the Mini App button.'
          ) : (
            <span className="text-danger">
              Enter a valid URL (including https://) or leave empty.
            </span>
          )}
        </Hint>
      </div>
    </PanelSection>
  );
}
