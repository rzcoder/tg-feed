/**
 * Settings → Bot card.
 *
 * One self-contained card holding every bot-related setting — connection
 * params (token / admins / public URL, stored DB-over-env) and the stats
 * digest schedule — behind a single status header and one Save / Reset.
 *
 * The two halves persist to different endpoints (bot config → /api/config/bot,
 * digest → /api/settings); Save fires only the dirty halves and reports one
 * outcome. "Reset all to .env" clears the DB bot-config row. The digest's time
 * zone is captured from the browser on save (no picker), matching how the
 * scheduler interprets it.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, KeyRound, Plus, Power, Search, User, X } from 'lucide-react';
import type {
  BotAdmin,
  StatsDigestFrequency,
  UpdateBotConfigRequest,
  UpdateSettingsRequest,
} from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Hint, Input } from '@/components/ui/input';
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
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { cn } from '@/lib/cn';
import {
  CardFooter,
  CardHeader,
  FieldHead,
  InlineSelect,
  PanelSection,
  SettingsCard,
  StatusPill,
  Toggle,
} from './primitives';

const FREQUENCIES: ReadonlyArray<{ value: StatsDigestFrequency; label: string }> = [
  { value: 'daily', label: 'daily' },
  { value: 'weekly', label: 'weekly' },
];

const DAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const;

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

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function BotSettingsCard() {
  const cfg = useBotConfig();
  const settings = useSettings();
  const updateBot = useUpdateBotConfig();
  const updateSettings = useUpdateSettings();
  const delMut = useDeleteBotConfig();
  const toast = useToast();

  const data = cfg.data;
  const s = settings.data;
  const localTz = useMemo(localTimeZone, []);

  // Bot-config drafts.
  const [tokenDraft, setTokenDraft] = useState('');
  const [admins, setAdmins] = useState<BotAdmin[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  // Digest drafts.
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<StatsDigestFrequency>('daily');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [time, setTime] = useState('09:00');

  const adminsJson = JSON.stringify(data?.admins ?? []);
  const urlKey = data?.publicUrl ?? '';
  useEffect(() => {
    setAdmins(JSON.parse(adminsJson) as BotAdmin[]);
    setUrlDraft(urlKey);
  }, [adminsJson, urlKey]);

  useEffect(() => {
    if (!s) return;
    setEnabled(s.statsDigestEnabled);
    setFrequency(s.statsDigestFrequency);
    setDayOfWeek(s.statsDigestDayOfWeek);
    setTime(s.statsDigestTime);
  }, [s?.statsDigestEnabled, s?.statsDigestFrequency, s?.statsDigestDayOfWeek, s?.statsDigestTime]);

  if (cfg.isPending || settings.isPending) {
    return (
      <SettingsCard className="p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Loading…</span>
      </SettingsCard>
    );
  }

  if (cfg.isError || !data || !s) {
    return (
      <SettingsCard className="p-3.5">
        <span className="text-[13px] text-text-muted">Failed to load bot configuration.</span>
      </SettingsCard>
    );
  }

  const urlTrimmed = urlDraft.trim();
  const urlValid = urlTrimmed === '' || isValidUrl(urlTrimmed);

  const tokenDirty = tokenDraft.trim().length > 0;
  const adminsDirty = adminIdsKey(admins) !== adminIdsKey(data.admins);
  const urlDirty = urlTrimmed !== (data.publicUrl ?? '');
  const botDirty = tokenDirty || adminsDirty || urlDirty;

  const enabledDirty = enabled !== s.statsDigestEnabled;
  const freqDirty = frequency !== s.statsDigestFrequency;
  const dayDirty = dayOfWeek !== s.statsDigestDayOfWeek;
  const timeDirty = time !== s.statsDigestTime;
  const tzMismatch = localTz !== s.statsDigestTimezone;
  const digestDirty = enabledDirty || freqDirty || dayDirty || timeDirty || (enabled && tzMismatch);

  const dirty = botDirty || digestDirty;
  const busy = updateBot.isPending || updateSettings.isPending || delMut.isPending;
  const keyMissingForToken = tokenDirty && !data.encryptionKeyConfigured;
  // Each half gates on its own validity, so an invalid Public URL (a bot
  // field) can't block saving an unrelated digest edit, and vice-versa.
  const botSavable = botDirty && urlValid && !keyMissingForToken;
  const digestSavable = digestDirty;
  const canSave = !busy && (botSavable || digestSavable);

  const hasDbConfig =
    data.tokenSource === 'db' || data.adminsSource === 'db' || data.publicUrlSource === 'db';
  const botReady = data.botRunning && admins.length > 0;

  const resetToken = () =>
    updateBot.mutate(
      { token: null },
      {
        onSuccess: () => toast.show('Bot token reset to .env'),
        onError: (err) => toast.show(apiErrorMessage(err, 'Failed to reset')),
      },
    );

  const resetToEnvLink = (
    <button
      type="button"
      className="text-accent hover:underline disabled:opacity-55"
      disabled={busy}
      onClick={resetToken}
    >
      Reset to .env
    </button>
  );

  const resetDrafts = () => {
    setTokenDraft('');
    setAdmins(JSON.parse(adminsJson) as BotAdmin[]);
    setUrlDraft(urlKey);
    setEnabled(s.statsDigestEnabled);
    setFrequency(s.statsDigestFrequency);
    setDayOfWeek(s.statsDigestDayOfWeek);
    setTime(s.statsDigestTime);
  };

  const save = async () => {
    // Run the two halves independently so a failure in one doesn't hide a
    // success in the other, and report per-half so the user knows what landed.
    const jobs: Array<{ half: 'bot' | 'digest'; run: () => Promise<unknown> }> = [];
    if (botSavable) {
      const body: UpdateBotConfigRequest = {};
      if (tokenDirty) body.token = tokenDraft.trim();
      if (adminsDirty) body.admins = admins.length > 0 ? admins : null;
      if (urlDirty) body.publicUrl = urlTrimmed.length > 0 ? urlTrimmed : null;
      jobs.push({ half: 'bot', run: () => updateBot.mutateAsync(body) });
    }
    if (digestSavable) {
      const body: UpdateSettingsRequest = {};
      if (enabledDirty) body.statsDigestEnabled = enabled;
      if (freqDirty) body.statsDigestFrequency = frequency;
      if (dayDirty) body.statsDigestDayOfWeek = dayOfWeek;
      if (timeDirty) body.statsDigestTime = time;
      if (tzMismatch) body.statsDigestTimezone = localTz;
      jobs.push({ half: 'digest', run: () => updateSettings.mutateAsync(body) });
    }
    if (jobs.length === 0) return;

    const results = await Promise.allSettled(jobs.map((j) => j.run()));
    const botOk = results.every((r, i) => jobs[i]?.half !== 'bot' || r.status === 'fulfilled');
    // Only clear the (write-only) token field once the bot write actually
    // landed, so a failed save doesn't silently drop the typed token.
    if (botOk && tokenDirty) setTokenDraft('');

    const failed = jobs.filter((_, i) => results[i]?.status === 'rejected').map((j) => j.half);
    if (failed.length === 0) toast.show('Settings saved');
    else if (failed.length === jobs.length) toast.show('Failed to save');
    else toast.show(`Saved, but ${failed.join(' & ')} settings failed`);
  };

  const existingAdminIds = new Set(admins.map((a) => a.id));

  return (
    <SettingsCard>
      <CardHeader
        icon={<Power size={14} />}
        title={data.botRunning ? 'Bot running' : 'Bot not running'}
        right={
          <StatusPill tone={data.botRunning ? 'live' : 'neutral'}>
            {data.botRunning ? 'online' : 'offline'}
          </StatusPill>
        }
      />

      <div className="p-4 flex flex-col gap-5">
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
                . The app fell back to env — paste a new token or reset it.
              </span>
              <div className="mt-1">
                <Button variant="ghost" size="sm" disabled={busy} onClick={resetToken}>
                  {updateBot.isPending ? <Spinner size={12} /> : null}
                  Reset token to .env
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Connection ── */}
        <PanelSection label="Connection">
          {/* Bot token */}
          <div>
            <FieldHead label="Bot token" source={data.tokenSource} />
            <Input
              type="password"
              autoComplete="off"
              monospace
              placeholder={
                data.tokenConfigured ? 'Paste a new token to replace' : 'Paste bot token'
              }
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
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
                Set <code className="font-mono">TG_SESSION_ENCRYPTION_KEY</code> in .env to store a
                bot token in the database.
              </Hint>
            )}
          </div>

          {/* Admins */}
          <div>
            <FieldHead label="Admins" source={data.adminsSource} />
            {admins.length === 0 ? (
              <p className="text-[12px] text-text-muted py-1">No admins yet — look one up below.</p>
            ) : (
              <div className="flex flex-col gap-1.5 mb-2">
                {admins.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2.5 pl-3 pr-1.5 py-2 rounded-lg bg-surface-2 border border-border"
                  >
                    <span className="grid place-items-center w-[26px] h-[26px] rounded-[7px] bg-surface-3 text-text-2 flex-shrink-0">
                      <User size={13} />
                    </span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-mono text-[13px] font-medium truncate">
                        {adminLabel(a)}
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
            <Hint>Look up a Telegram user to allow — @username, t.me link, or numeric id.</Hint>
          </div>

          {/* Public URL */}
          <div>
            <FieldHead label="Public URL" source={data.publicUrlSource} />
            <Input
              type="url"
              inputMode="url"
              monospace
              placeholder="https://tg-feed.example.com"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
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

        <div className="h-px bg-border" />

        {/* ── Stats digest ── */}
        <PanelSection
          label="Stats digest"
          right={<Toggle checked={enabled} onChange={setEnabled} label="Enable stats digest" />}
        >
          <div className="-mt-2">
            <Hint>Bot DMs admins a forwarded / filtered / error summary.</Hint>
          </div>

          {enabled && !botReady && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning-soft text-warning border border-warning/40 text-[12px] leading-relaxed">
              <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
              <span>
                Add a bot token + at least one admin above so the digest can be delivered.
              </span>
            </div>
          )}

          <div
            className={cn(
              'transition-opacity duration-150',
              enabled ? 'opacity-100' : 'opacity-40 pointer-events-none',
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2 leading-[2]">
              <span>Send</span>
              <InlineSelect
                ariaLabel="Digest frequency"
                value={frequency}
                onChange={setFrequency}
                options={FREQUENCIES}
              />
              {frequency === 'weekly' && (
                <>
                  <span>on</span>
                  <InlineSelect
                    ariaLabel="Day of week"
                    value={String(dayOfWeek)}
                    onChange={(v) => setDayOfWeek(Number(v))}
                    options={DAY_OPTIONS}
                  />
                </>
              )}
              <span>at</span>
              <input
                type="time"
                aria-label="Digest time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-[30px] px-2.5 rounded-[7px] bg-surface-2 border border-border text-[13px] font-semibold text-text outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
              <span className="inline-flex items-center gap-1.5 h-[26px] px-2 rounded-full border border-border bg-surface-2 text-[11.5px] text-text-2">
                {localTz}
              </span>
            </div>
          </div>
        </PanelSection>
      </div>

      <CardFooter
        left={
          hasDbConfig ? (
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
              Reset all to .env
            </Button>
          ) : undefined
        }
      >
        <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={resetDrafts}>
          Reset
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
          {busy ? <Spinner size={14} /> : <Check size={14} strokeWidth={2.5} />}
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </SettingsCard>
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
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="@username or numeric id"
            monospace
            disabled={disabled}
            className="pl-9"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="h-[42px]"
          disabled={disabled || !resolved || already}
          onClick={add}
        >
          <Plus size={14} /> Add
        </Button>
      </div>

      {(resolve.isPending || resolved || resolve.error) && (
        <div className="mt-2">
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
        </div>
      )}
    </div>
  );
}
