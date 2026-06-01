/**
 * Owns the editable drafts behind the Bot settings card — both halves: the
 * bot-connection fields (token / admins / public URL) and the stats-digest
 * schedule. Seeds them from the server payloads and exposes a single
 * `seedFromServer` so the seeding effects and the Reset action share one field
 * list (no drift between "what gets seeded" and "what gets reset").
 *
 * Called unconditionally (before the card's loading/error guards), so the
 * server payloads may be undefined on the first renders; the seeding effects
 * tolerate that exactly as the inline versions did. Dirty derivation and save
 * orchestration stay in the card, next to the mutations they drive — this hook
 * only owns the draft values and their setters.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { BotAdmin, BotConfigInfo, SettingsDto, StatsDigestFrequency } from '@tg-feed/shared';
import { localTimeZone } from './utils';

export interface BotSettingsDraft {
  // Bot-config drafts.
  tokenDraft: string;
  setTokenDraft: (value: string) => void;
  admins: BotAdmin[];
  setAdmins: Dispatch<SetStateAction<BotAdmin[]>>;
  urlDraft: string;
  setUrlDraft: (value: string) => void;
  // Digest drafts.
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  frequency: StatsDigestFrequency;
  setFrequency: (value: StatsDigestFrequency) => void;
  dayOfWeek: number;
  setDayOfWeek: (value: number) => void;
  time: string;
  setTime: (value: string) => void;

  /** Browser time zone the digest time is read in; captured once. */
  localTz: string;

  /**
   * Re-seed every draft from the latest server payloads (used by Reset). A
   * no-op until both payloads have loaded, matching the card's guards.
   */
  seedFromServer: () => void;
}

export function useBotSettingsDraft(
  data: BotConfigInfo | undefined,
  s: SettingsDto | undefined,
): BotSettingsDraft {
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

  // Stable keys so the seeding effects only re-run when the underlying server
  // values actually change (not on every cache reference swap).
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

  const seedFromServer = () => {
    setTokenDraft('');
    setAdmins(JSON.parse(adminsJson) as BotAdmin[]);
    setUrlDraft(urlKey);
    if (!s) return;
    setEnabled(s.statsDigestEnabled);
    setFrequency(s.statsDigestFrequency);
    setDayOfWeek(s.statsDigestDayOfWeek);
    setTime(s.statsDigestTime);
  };

  return {
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
  };
}
