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
 *
 * Draft state lives in `useBotSettingsDraft`; the connection and digest fields
 * render through the `bot/` sub-components. This card keeps the save
 * orchestration (the two-half Promise.allSettled write + per-half reporting)
 * and the DB-reset / key-mismatch affordances.
 */
import { Check, KeyRound, Power } from 'lucide-react';
import type { UpdateBotConfigRequest, UpdateSettingsRequest } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { apiErrorMessage } from '@/api/client';
import { useBotConfig, useDeleteBotConfig, useUpdateBotConfig } from '@/hooks/useBotConfig';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { CardFooter, CardHeader, SettingsCard, StatusPill } from './primitives';
import { ConnectionSection } from './bot/ConnectionSection';
import { DigestSection } from './bot/DigestSection';
import { useBotSettingsDraft } from './bot/useBotSettingsDraft';
import { adminIdsKey, isValidUrl } from './bot/utils';

export function BotSettingsCard() {
  const cfg = useBotConfig();
  const settings = useSettings();
  const updateBot = useUpdateBotConfig();
  const updateSettings = useUpdateSettings();
  const delMut = useDeleteBotConfig();
  const toast = useToast();

  const data = cfg.data;
  const s = settings.data;
  const draft = useBotSettingsDraft(data, s);

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

  const {
    tokenDraft,
    setTokenDraft,
    admins,
    setAdmins,
    urlDraft,
    setUrlDraft,
    enabled,
    setEnabled,
    frequency,
    setFrequency,
    dayOfWeek,
    setDayOfWeek,
    time,
    setTime,
    localTz,
    seedFromServer,
  } = draft;

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
        onError: (err) => toast.error(apiErrorMessage(err, 'Failed to reset')),
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
    else if (failed.length === jobs.length) toast.error('Failed to save');
    else toast.error(`Saved, but ${failed.join(' & ')} settings failed`);
  };

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
                <Button
                  variant="ghost"
                  size="sm"
                  loading={updateBot.isPending}
                  spinnerSize={12}
                  disabled={busy}
                  onClick={resetToken}
                >
                  Reset token to .env
                </Button>
              </div>
            </div>
          </div>
        )}

        <ConnectionSection
          data={data}
          busy={busy}
          tokenDraft={tokenDraft}
          onTokenChange={setTokenDraft}
          admins={admins}
          onRemoveAdmin={(id) => setAdmins((xs) => xs.filter((x) => x.id !== id))}
          onAddAdmin={(admin) => setAdmins((xs) => [...xs, admin])}
          urlDraft={urlDraft}
          onUrlChange={setUrlDraft}
          urlValid={urlValid}
          resetToEnvLink={resetToEnvLink}
        />

        <div className="h-px bg-border" />

        <DigestSection
          enabled={enabled}
          onEnabledChange={setEnabled}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          dayOfWeek={dayOfWeek}
          onDayOfWeekChange={setDayOfWeek}
          time={time}
          onTimeChange={setTime}
          localTz={localTz}
          botReady={botReady}
        />
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
                  onError: (err) => toast.error(apiErrorMessage(err, 'Failed to reset')),
                })
              }
            >
              Reset all to .env
            </Button>
          ) : undefined
        }
      >
        <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={seedFromServer}>
          Reset
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Check size={14} strokeWidth={2.5} />}
          loading={busy}
          disabled={!canSave}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </SettingsCard>
  );
}
