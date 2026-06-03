// Called before the card's loading/error guards, so server payloads may be undefined on first renders and the seeding effects tolerate that.
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { BotAdmin, BotConfigInfo, SettingsDto, StatsDigestFrequency } from '@tg-feed/shared';
import { localTimeZone } from './utils';

export interface BotSettingsDraft {
  tokenDraft: string;
  setTokenDraft: (value: string) => void;
  admins: BotAdmin[];
  setAdmins: Dispatch<SetStateAction<BotAdmin[]>>;
  urlDraft: string;
  setUrlDraft: (value: string) => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  frequency: StatsDigestFrequency;
  setFrequency: (value: StatsDigestFrequency) => void;
  dayOfWeek: number;
  setDayOfWeek: (value: number) => void;
  time: string;
  setTime: (value: string) => void;

  localTz: string;

  // No-op until both payloads have loaded, matching the card's guards.
  seedFromServer: () => void;
}

export function useBotSettingsDraft(
  data: BotConfigInfo | undefined,
  s: SettingsDto | undefined,
): BotSettingsDraft {
  const localTz = useMemo(localTimeZone, []);

  const [tokenDraft, setTokenDraft] = useState('');
  const [admins, setAdmins] = useState<BotAdmin[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<StatsDigestFrequency>('daily');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [time, setTime] = useState('09:00');

  // Stable keys so seeding re-runs on value changes, not every cache reference swap.
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
