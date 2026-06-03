// Reads the digest knobs from the 'global' app_settings row on every tick, so changes apply live.
// `.catch(default)` per field means a hand-edited/partial row can never crash the scheduler.
import { statsDigestSettingsSchema, type StatsDigestFrequency } from '@tg-feed/shared';
import type { Db } from '../db/client.js';
import { readGlobalValue } from './throttle.js';

export interface StatsDigestConfig {
  enabled: boolean;
  frequency: StatsDigestFrequency;
  /** 0 = Sunday … 6 = Saturday. Only meaningful when frequency is 'weekly'. */
  dayOfWeek: number;
  /** HH:MM, 24-hour. */
  time: string;
  /** IANA time zone the `time` is interpreted in. */
  timezone: string;
}

export function getStatsDigestConfig(db: Db): StatsDigestConfig {
  const parsed = statsDigestSettingsSchema.parse(readGlobalValue(db) ?? {});
  return {
    enabled: parsed.statsDigestEnabled,
    frequency: parsed.statsDigestFrequency,
    dayOfWeek: parsed.statsDigestDayOfWeek,
    time: parsed.statsDigestTime,
    timezone: parsed.statsDigestTimezone,
  };
}
