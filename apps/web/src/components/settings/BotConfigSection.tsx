/**
 * Settings → Bot card.
 *
 * Edits the Telegram bot config (token, admin allowlist, public URL) stored
 * in the DB with priority over env. The token is a secret, so its field is
 * gated on `TG_SESSION_ENCRYPTION_KEY` and never pre-filled (paste a new one
 * to replace); a key-fingerprint mismatch surfaces an amber banner. Per-field
 * source badges show whether a value currently comes from the database or
 * `.env`.
 *
 * Admins are added by lookup: type a `@username` (or numeric id), it resolves
 * to a user, and the resolved entry is appended to the list. Each entry shows
 * the looked-up name.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, KeyRound, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { ResolveCard } from '@/components/domain/ResolveCard';
import { apiErrorMessage } from '@/api/client';
import { useDebouncedResolve } from '@/hooks/useDebouncedResolve';
import {
  useBotConfig,
  useDeleteBotConfig,
  useResolveBotAdmin,
  useUpdateBotConfig,
} from '@/hooks/useBotConfig';
import type { BotAdmin, BotConfigSource, UpdateBotConfigRequest } from '@tg-feed/shared';

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function adminIdsKey(admins: BotAdmin[]): string {
  return admins.map((a) => a.id).join(',');
}

function adminLabel(a: BotAdmin): string {
  return a.displayName ?? (a.username ? `@${a.username}` : a.id);
}

function SourceBadge({ source }: { source: BotConfigSource | null }) {
  if (!source) return <span className="text-[10.5px] text-text-faint">not set</span>;
  return (
    <span className="text-[10.5px] text-text-faint">{source === 'db' ? 'database' : '.env'}</span>
  );
}

export function BotConfigSection() {
  const cfg = useBotConfig();
  const updateMut = useUpdateBotConfig();
  const delMut = useDeleteBotConfig();
  const toast = useToast();
  const data = cfg.data;

  const [tokenDraft, setTokenDraft] = useState('');
  const [admins, setAdmins] = useState<BotAdmin[]>([]);
  const [urlDraft, setUrlDraft] = useState('');

  // Reset editable drafts whenever the server values change (initial load and
  // after a save/delete). Serialize the admin list so the dep stays primitive
  // (no ref-churn). The token is a secret — never pre-filled.
  const adminsJson = JSON.stringify(data?.admins ?? []);
  const urlKey = data?.publicUrl ?? '';
  useEffect(() => {
    setAdmins(JSON.parse(adminsJson) as BotAdmin[]);
    setUrlDraft(urlKey);
  }, [adminsJson, urlKey]);

  const urlTrimmed = urlDraft.trim();
  const urlValid = urlTrimmed === '' || isValidUrl(urlTrimmed);

  const tokenDirty = tokenDraft.trim().length > 0;
  const adminsDirty = data ? adminIdsKey(admins) !== adminIdsKey(data.admins) : false;
  const urlDirty = data ? urlTrimmed !== (data.publicUrl ?? '') : false;
  const dirty = tokenDirty || adminsDirty || urlDirty;

  const busy = updateMut.isPending || delMut.isPending;
  const keyMissingForToken = tokenDirty && data?.encryptionKeyConfigured === false;
  const canSave = dirty && urlValid && !keyMissingForToken && !busy;

  const existingAdminIds = useMemo(() => new Set(admins.map((a) => a.id)), [admins]);

  if (cfg.isPending) {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Loading…</span>
      </div>
    );
  }

  if (cfg.isError || !data) {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 text-[13px] text-text-muted">
        Failed to load bot configuration.
      </div>
    );
  }

  const save = () => {
    const body: UpdateBotConfigRequest = {};
    if (tokenDirty) body.token = tokenDraft.trim();
    if (adminsDirty) body.admins = admins.length > 0 ? admins : null;
    if (urlDirty) body.publicUrl = urlTrimmed.length > 0 ? urlTrimmed : null;
    updateMut.mutate(body, {
      onSuccess: () => {
        setTokenDraft('');
        toast.show('Bot settings saved');
      },
      onError: (err) => toast.show(apiErrorMessage(err, 'Failed to save')),
    });
  };

  const resetToken = () => {
    updateMut.mutate(
      { token: null },
      {
        onSuccess: () => toast.show('Bot token reset to .env'),
        onError: (err) => toast.show(apiErrorMessage(err, 'Failed to reset')),
      },
    );
  };

  const hasDbConfig =
    data.tokenSource === 'db' || data.adminsSource === 'db' || data.publicUrlSource === 'db';

  const tokenStatus = !data.tokenConfigured
    ? 'No bot token configured'
    : data.tokenSource === 'db'
      ? 'Token stored in database'
      : 'Using TG_BOT_TOKEN from .env';

  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-4 flex flex-col gap-4">
      {/* Status row */}
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
            data.botRunning ? 'bg-success' : 'bg-text-faint'
          }`}
          aria-hidden
        />
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <Bot size={14} className="text-text-muted" />
          {data.botRunning ? 'Bot running' : 'Bot not running'}
        </div>
      </div>

      {data.keyFingerprintMismatch && (
        <div
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning-soft text-warning p-3 flex items-start gap-2.5"
        >
          <KeyRound size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[13px] font-medium">Stored token uses a different key</span>
            <span className="text-[12px] leading-relaxed break-words">
              The bot token in the database was encrypted with a different{' '}
              <code className="px-1 rounded bg-warning/15 font-mono text-[11.5px]">
                TG_SESSION_ENCRYPTION_KEY
              </code>
              . The app fell back to env. Paste a new token below, or reset it.
            </span>
            <div className="mt-1">
              <Button variant="ghost" size="sm" onClick={resetToken} disabled={busy}>
                {updateMut.isPending ? <Spinner size={12} /> : null}
                Reset token to .env
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bot token */}
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="bot-token">Bot token</Label>
          <SourceBadge source={data.tokenSource} />
        </div>
        <Input
          id="bot-token"
          type="password"
          autoComplete="off"
          monospace
          placeholder={data.tokenConfigured ? 'Paste a new token to replace' : 'Paste bot token'}
          value={tokenDraft}
          onChange={(e) => setTokenDraft(e.target.value)}
          disabled={!data.encryptionKeyConfigured || busy}
        />
        {data.encryptionKeyConfigured ? (
          <Hint>
            {tokenStatus}. Get one from @BotFather. Stored encrypted at rest.
            {data.tokenSource === 'db' && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-accent hover:underline disabled:opacity-55"
                  onClick={resetToken}
                  disabled={busy}
                >
                  Reset to .env
                </button>
              </>
            )}
          </Hint>
        ) : (
          <Hint>
            Set <code className="font-mono">TG_SESSION_ENCRYPTION_KEY</code> in .env to store a bot
            token in the database. {tokenStatus}.
          </Hint>
        )}
      </div>

      {/* Admins */}
      <div>
        <div className="flex items-center justify-between">
          <Label>Admins</Label>
          <SourceBadge source={data.adminsSource} />
        </div>

        {admins.length === 0 ? (
          <p className="text-[12px] text-text-muted py-1">No admins yet — look one up below.</p>
        ) : (
          <div className="flex flex-col gap-1.5 mb-2">
            {admins.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 pl-3 pr-1.5 py-1.5"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-medium truncate">{adminLabel(a)}</span>
                  <span className="text-[11px] text-text-muted font-mono truncate">
                    {a.displayName && a.username ? `@${a.username} · ${a.id}` : a.id}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${adminLabel(a)}`}
                  disabled={busy}
                  onClick={() => setAdmins((xs) => xs.filter((x) => x.id !== a.id))}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <AdminLookup
          existingIds={existingAdminIds}
          disabled={busy}
          onAdd={(admin) => setAdmins((xs) => [...xs, admin])}
        />
      </div>

      {/* Public URL */}
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="bot-url">Public URL</Label>
          <SourceBadge source={data.publicUrlSource} />
        </div>
        <Input
          id="bot-url"
          type="url"
          inputMode="url"
          placeholder="https://tg-feed.example.com"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          invalid={!urlValid}
          disabled={busy}
        />
        <Hint>
          {urlValid
            ? 'Where the web client is served. Must be https:// for the Mini App button.'
            : 'Enter a valid URL (including https://) or leave empty.'}
        </Hint>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {hasDbConfig ? (
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() =>
              delMut.mutate(undefined, {
                onSuccess: () => toast.show('Reset to environment'),
                onError: (err) => toast.show(apiErrorMessage(err, 'Failed to reset')),
              })
            }
          >
            {delMut.isPending ? <Spinner size={12} /> : null}
            Reset all to .env
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || busy}
            onClick={() => {
              setTokenDraft('');
              setAdmins(JSON.parse(adminsJson) as BotAdmin[]);
              setUrlDraft(urlKey);
            }}
          >
            Reset
          </Button>
          <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
            {updateMut.isPending ? <Spinner size={14} /> : <Check size={14} strokeWidth={2.5} />}
            {updateMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminLookup({
  existingIds,
  disabled,
  onAdd,
}: {
  existingIds: Set<string>;
  disabled: boolean;
  onAdd: (admin: BotAdmin) => void;
}) {
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
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="@username or numeric id"
        monospace
        disabled={disabled}
      />
      <Hint>Look up a Telegram user to allow — paste a @username, t.me link, or numeric id.</Hint>

      {(resolve.isPending || resolved || resolve.error) && (
        <div className="mt-2 flex flex-col gap-2">
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
          {resolved && (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" disabled={already || disabled} onClick={add}>
                <Plus size={13} />
                {already ? 'Already added' : 'Add admin'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
