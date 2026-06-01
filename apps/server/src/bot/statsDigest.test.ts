import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDbHandle } from '../db/testing.js';
import { appSettings, forwardLog } from '../db/schema.js';
import type { ForwardLogStatus, StatsDigestFrequency } from '@tg-feed/shared';
import { GLOBAL_SETTINGS_KEY } from '../forwarding/throttle.js';
import { readStatsDigestState } from '../db/statsDigestStateRepo.js';
import { createLogger } from '../lib/logger.js';
import type { TgFeedBot } from './bot.js';
import { createStatsDigestScheduler, formatDigest, occurrenceKey } from './statsDigest.js';

const logger = createLogger({ silent: true });

interface DigestConfigInput {
  enabled: boolean;
  frequency: StatsDigestFrequency;
  dayOfWeek: number;
  time: string;
  timezone: string;
}

describe('occurrenceKey', () => {
  const daily = (time: string, timezone = 'UTC') => ({
    enabled: true,
    frequency: 'daily' as const,
    dayOfWeek: 1,
    time,
    timezone,
  });

  it('flips the daily occurrence at the scheduled minute', () => {
    const day = (h: number, m: number) => Date.UTC(2026, 5, 1, h, m);
    expect(occurrenceKey(day(8, 59), daily('09:00'))).toBe('daily:2026-05-31');
    expect(occurrenceKey(day(9, 0), daily('09:00'))).toBe('daily:2026-06-01');
    expect(occurrenceKey(day(9, 1), daily('09:00'))).toBe('daily:2026-06-01');
  });

  it('is time-zone aware (same instant, different local day)', () => {
    // 2026-06-01T01:00Z is still 2026-06-01 in Tokyo (10:00, past 09:00) but
    // only 2026-05-31 in UTC (01:00, before 09:00).
    const instant = Date.UTC(2026, 5, 1, 1, 0);
    expect(occurrenceKey(instant, daily('09:00', 'Asia/Tokyo'))).toBe('daily:2026-06-01');
    expect(occurrenceKey(instant, daily('09:00', 'UTC'))).toBe('daily:2026-05-31');
  });

  it('weekly picks the most recent past occurrence of the target weekday', () => {
    const base = Date.UTC(2026, 5, 1, 12, 0); // a fixed instant
    const weekday = new Date(base).getUTCDay();
    const cfg: DigestConfigInput = {
      enabled: true,
      frequency: 'weekly',
      dayOfWeek: weekday,
      time: '09:00',
      timezone: 'UTC',
    };
    // Same weekday, past 09:00 → today.
    expect(occurrenceKey(base, cfg)).toBe('weekly:2026-06-01');
    // Same weekday, before 09:00 → a week earlier.
    expect(occurrenceKey(Date.UTC(2026, 5, 1, 8, 0), cfg)).toBe('weekly:2026-05-25');
    // Next day (not the target weekday) → still last target weekday.
    expect(occurrenceKey(Date.UTC(2026, 5, 2, 12, 0), cfg)).toBe('weekly:2026-06-01');
  });
});

describe('formatDigest', () => {
  it('renders the counts and omits the throttled line when zero', () => {
    const cfg: DigestConfigInput = {
      enabled: true,
      frequency: 'daily',
      dayOfWeek: 1,
      time: '09:00',
      timezone: 'UTC',
    };
    const text = formatDigest(
      { forwarded: 5, filtered: 2, failed: 1, floodWait: 0 },
      Date.UTC(2026, 5, 1, 9, 0),
      Date.UTC(2026, 5, 2, 9, 0),
      cfg,
    );
    expect(text).toContain('Forwarded: <b>5</b>');
    expect(text).toContain('Filtered: <b>2</b>');
    expect(text).toContain('Errors: <b>1</b>');
    expect(text).not.toContain('Throttled');
  });

  it('includes the throttled line when flood waits occurred', () => {
    const cfg: DigestConfigInput = {
      enabled: true,
      frequency: 'daily',
      dayOfWeek: 1,
      time: '09:00',
      timezone: 'UTC',
    };
    const text = formatDigest({ forwarded: 0, filtered: 0, failed: 0, floodWait: 3 }, 0, 1, cfg);
    expect(text).toContain('Throttled: <b>3</b>');
  });
});

describe('createStatsDigestScheduler', () => {
  let handle: TestDbHandle;
  let nowMs: number;
  let sent: string[];
  let bot: TgFeedBot | undefined;
  let deliver: number;

  beforeEach(() => {
    handle = createTestDb();
    nowMs = 0;
    sent = [];
    deliver = 1;
    bot = {
      start: async () => {},
      stop: async () => {},
      notifyAdmins: async (text: string) => {
        sent.push(text);
        return deliver;
      },
    };
  });
  afterEach(() => {
    handle.close();
  });

  function setConfig(cfg: DigestConfigInput): void {
    const value = {
      statsDigestEnabled: cfg.enabled,
      statsDigestFrequency: cfg.frequency,
      statsDigestDayOfWeek: cfg.dayOfWeek,
      statsDigestTime: cfg.time,
      statsDigestTimezone: cfg.timezone,
    };
    handle.db
      .insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();
  }

  function insertLog(status: ForwardLogStatus, atMs: number): void {
    handle.db
      .insert(forwardLog)
      .values({
        sourceMessageId: '1',
        status,
        destMessageId: null,
        error: null,
        rawMessage: null,
        createdAt: new Date(atMs),
      })
      .run();
  }

  function makeScheduler(getBot: () => TgFeedBot | undefined = () => bot) {
    return createStatsDigestScheduler({ db: handle.db, getBot, logger, now: () => nowMs });
  }

  const DAILY: DigestConfigInput = {
    enabled: true,
    frequency: 'daily',
    dayOfWeek: 1,
    time: '09:00',
    timezone: 'UTC',
  };
  const DAY1_10 = Date.UTC(2026, 5, 1, 10, 0);
  const DAY2_0930 = Date.UTC(2026, 5, 2, 9, 30);

  it('does not send when disabled', async () => {
    setConfig({ ...DAILY, enabled: false });
    const s = makeScheduler();
    nowMs = DAY1_10;
    await s.runOnce();
    expect(sent).toHaveLength(0);
  });

  it('baselines on first enable without an immediate send', async () => {
    setConfig(DAILY);
    const s = makeScheduler();
    nowMs = DAY1_10; // already past 09:00 today
    await s.runOnce();
    expect(sent).toHaveLength(0); // baseline, not a backlog blast
    const state = readStatsDigestState(handle.db);
    expect(state.lastKey).toBe('daily:2026-06-01');
    expect(state.lastSentAt).toBe(DAY1_10);
  });

  it('sends once at the next occurrence and not again within it', async () => {
    setConfig(DAILY);
    const s = makeScheduler();
    nowMs = DAY1_10;
    await s.runOnce(); // baseline

    insertLog('sent', Date.UTC(2026, 5, 1, 12, 0));
    insertLog('sent', Date.UTC(2026, 5, 2, 8, 0));
    insertLog('filtered', Date.UTC(2026, 5, 2, 8, 30));

    nowMs = DAY2_0930;
    await s.runOnce(); // fires
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Forwarded: <b>2</b>');
    expect(sent[0]).toContain('Filtered: <b>1</b>');

    nowMs = Date.UTC(2026, 5, 2, 9, 45);
    await s.runOnce(); // same occurrence → no resend
    expect(sent).toHaveLength(1);
  });

  it('keeps the window start (but advances the key) when no admin received it', async () => {
    setConfig(DAILY);
    const s = makeScheduler();
    nowMs = DAY1_10;
    await s.runOnce(); // baseline; lastSentAt = DAY1_10

    deliver = 0; // every send fails (e.g. admins never opened the bot)
    nowMs = DAY2_0930;
    await s.runOnce();
    expect(sent).toHaveLength(1); // attempted once
    const state = readStatsDigestState(handle.db);
    expect(state.lastKey).toBe('daily:2026-06-02'); // key advanced → no per-tick retry storm
    expect(state.lastSentAt).toBe(DAY1_10); // window NOT advanced → rolls into the next digest
  });

  it('catches up at most once after the server was down across occurrences', async () => {
    setConfig(DAILY);
    const s = makeScheduler();
    nowMs = DAY1_10;
    await s.runOnce(); // baseline at day 1

    // Skip straight to day 4 — two scheduled occurrences (day 2, day 3) passed.
    nowMs = Date.UTC(2026, 5, 4, 10, 0);
    await s.runOnce();
    expect(sent).toHaveLength(1); // a single catch-up digest, not one per missed day
  });

  it('does not advance while the bot is unavailable, then catches up', async () => {
    setConfig(DAILY);
    const s = makeScheduler(() => undefined); // bot down for these ticks
    nowMs = DAY1_10;
    await s.runOnce(); // re-baseline still happens (no bot needed)

    nowMs = DAY2_0930;
    await s.runOnce(); // would fire, but bot is down → skip without advancing
    expect(readStatsDigestState(handle.db).lastKey).toBe('daily:2026-06-01');

    // Bot returns; same scheduler with a live getBot.
    const s2 = createStatsDigestScheduler({
      db: handle.db,
      getBot: () => bot,
      logger,
      now: () => nowMs,
    });
    await s2.runOnce();
    expect(sent).toHaveLength(1);
  });

  it('re-baselines on a schedule change instead of firing immediately', async () => {
    setConfig(DAILY);
    const s = makeScheduler();
    nowMs = DAY1_10;
    await s.runOnce(); // baseline, lastKey = day 1

    // Operator edits the time later the same day; the new occurrence key
    // differs, but a config change must re-baseline, not send.
    setConfig({ ...DAILY, time: '11:00' });
    nowMs = Date.UTC(2026, 5, 1, 10, 30);
    await s.runOnce();
    expect(sent).toHaveLength(0);
  });

  it('fires weekly only on the configured weekday', async () => {
    const base = Date.UTC(2026, 5, 1, 10, 0);
    const weekday = new Date(base).getUTCDay();
    setConfig({
      enabled: true,
      frequency: 'weekly',
      dayOfWeek: weekday,
      time: '09:00',
      timezone: 'UTC',
    });
    const s = makeScheduler();
    nowMs = base;
    await s.runOnce(); // baseline this week

    // Next day (wrong weekday) → no fire.
    nowMs = Date.UTC(2026, 5, 2, 12, 0);
    await s.runOnce();
    expect(sent).toHaveLength(0);

    // Same weekday next week, past the time → fire once.
    nowMs = Date.UTC(2026, 5, 8, 9, 30);
    await s.runOnce();
    expect(sent).toHaveLength(1);
  });
});
