/**
 * Stats-digest config reader.
 *
 * The digest knobs live alongside the throttle knobs in the single
 * `app_settings` row keyed `'global'` (see throttle.ts). The shared
 * `statsDigestSettingsSchema` validates each field with a `.catch(default)`,
 * so a missing row, missing field, or malformed value all read back as the
 * documented default — a hand-edited or partially-written row can never crash
 * the scheduler. The Settings UI mutates the same row and the scheduler reads
 * it on every tick, so changes apply live without a restart.
 */
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
