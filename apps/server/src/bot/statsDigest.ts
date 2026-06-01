/**
 * Stats-digest scheduler.
 *
 * Once a day or once a week, at a chosen local time, the bot DMs its admins a
 * forwarded/filtered/error summary. Telegram has no wall-clock scheduling
 * primitive and the rest of the app uses fixed-interval pollers, so this is a
 * minute-tick poller that decides on each tick whether the scheduled moment
 * has passed and a digest is still owed.
 *
 * Dedup is by an *occurrence key* — a stable label for "the most recent
 * scheduled time at-or-before now", derived purely from the time zone's
 * wall-clock parts (no epoch/offset/DST math). We send at most once per
 * occurrence and persist the key, which also yields free catch-up: if the
 * server was down across a scheduled time, the next tick after boot still
 * sees an unsent occurrence and sends it.
 *
 * Any change to the schedule (enable/disable, time, day, frequency, zone)
 * re-baselines via a config fingerprint: the current occurrence is marked
 * handled without sending, so editing the schedule never triggers an
 * immediate or backlog blast — the first real send is the next occurrence.
 *
 * The window is [lastSentAt, now): every message is counted in exactly one
 * digest, with no gaps or overlaps.
 */
import type { Db } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import { createPoller } from '../lib/poller.js';
import { getStatsDigestConfig, type StatsDigestConfig } from '../forwarding/statsDigestConfig.js';
import { getDigestStats, type DigestStats } from '../forwarding/stats.js';
import { readStatsDigestState, writeStatsDigestState } from '../db/statsDigestStateRepo.js';
import type { TgFeedBot } from './bot.js';

const TICK_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface StatsDigestSchedulerDeps {
  db: Db;
  /** Resolves the current bot; a getter because the ref is swapped on reload. */
  getBot: () => TgFeedBot | undefined;
  logger: Logger;
  /** Injectable clock (epoch ms) for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Tick cadence; defaults to 60s. */
  intervalMs?: number;
}

export interface StatsDigestScheduler {
  start(): void;
  stop(): void;
  /** Evaluate the schedule once. Exposed for tests; the poller calls it. */
  runOnce(): Promise<void>;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sun … 6=Sat
  hour: number; // 0-23
  minute: number;
}

/** Wall-clock parts of `epochMs` as seen in `timeZone`. */
function wallClockInZone(epochMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/**
 * Stable key for the most recent scheduled occurrence at-or-before `nowMs`,
 * e.g. `"daily:2026-06-01"` / `"weekly:2026-05-29"`. The date is computed on
 * the zone's wall-clock calendar; we render it via UTC arithmetic purely as an
 * opaque label (no offset needed).
 */
export function occurrenceKey(nowMs: number, cfg: StatsDigestConfig): string {
  const wc = wallClockInZone(nowMs, cfg.timezone);
  const [hh, mm] = cfg.time.split(':');
  const schedMin = Number(hh) * 60 + Number(mm);
  const nowMin = wc.hour * 60 + wc.minute;

  let backDays: number;
  if (cfg.frequency === 'daily') {
    backDays = nowMin >= schedMin ? 0 : 1;
  } else {
    backDays = (wc.weekday - cfg.dayOfWeek + 7) % 7;
    if (backDays === 0 && nowMin < schedMin) backDays = 7;
  }

  const occ = new Date(Date.UTC(wc.year, wc.month - 1, wc.day) - backDays * DAY_MS);
  const y = occ.getUTCFullYear();
  const m = String(occ.getUTCMonth() + 1).padStart(2, '0');
  const d = String(occ.getUTCDate()).padStart(2, '0');
  return `${cfg.frequency}:${y}-${m}-${d}`;
}

function configHash(cfg: StatsDigestConfig): string {
  return JSON.stringify({
    enabled: cfg.enabled,
    frequency: cfg.frequency,
    dayOfWeek: cfg.dayOfWeek,
    time: cfg.time,
    timezone: cfg.timezone,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Concise HTML body for the bot to DM. */
export function formatDigest(
  stats: DigestStats,
  sinceMs: number,
  untilMs: number,
  cfg: StatsDigestConfig,
): string {
  const fmt = (ms: number): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: cfg.timezone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms));

  const lines = [
    '📊 <b>tg-feed digest</b>',
    `<i>${escapeHtml(fmt(sinceMs))} → ${escapeHtml(fmt(untilMs))}</i>`,
    '',
    `✅ Forwarded: <b>${stats.forwarded}</b>`,
    `🚫 Filtered: <b>${stats.filtered}</b>`,
    `⚠️ Errors: <b>${stats.failed}</b>`,
  ];
  if (stats.floodWait > 0) lines.push(`⏳ Throttled: <b>${stats.floodWait}</b>`);
  return lines.join('\n');
}

export function createStatsDigestScheduler(deps: StatsDigestSchedulerDeps): StatsDigestScheduler {
  const { db, getBot, logger } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const intervalMs = deps.intervalMs ?? TICK_INTERVAL_MS;

  async function runOnce(): Promise<void> {
    const cfg = getStatsDigestConfig(db);
    const hash = configHash(cfg);
    const state = readStatsDigestState(db);
    const nowMs = now();

    // Schedule changed (or first ever tick) → re-baseline, never send. Record
    // the current occurrence as handled so the first real send is the next one.
    if (state.configHash !== hash) {
      writeStatsDigestState(db, {
        lastSentAt: nowMs,
        lastKey: cfg.enabled ? occurrenceKey(nowMs, cfg) : null,
        configHash: hash,
      });
      return;
    }

    if (!cfg.enabled) return;

    // Bot down — skip without advancing, so the unsent occurrence is caught up
    // on a later tick once the bot is back.
    const bot = getBot();
    if (!bot) return;

    const key = occurrenceKey(nowMs, cfg);
    if (key === state.lastKey) return; // already sent for this occurrence

    const since = state.lastSentAt ?? nowMs;
    const stats = getDigestStats(db, since, nowMs);
    const delivered = await bot.notifyAdmins(formatDigest(stats, since, nowMs, cfg));

    if (delivered > 0) {
      logger.info(
        { since, until: nowMs, frequency: cfg.frequency, admins: delivered, ...stats },
        'stats digest: sent to admins',
      );
    } else {
      logger.warn(
        { since, until: nowMs, frequency: cfg.frequency },
        'stats digest: reached no admins; counts will roll into the next digest',
      );
    }

    // Advance the occurrence key either way so we attempt at most once per
    // occurrence (no per-tick retry storm against admins who 403). But only
    // move the window start when something was actually delivered, so a
    // fully-undelivered period's counts roll into the next successful digest.
    writeStatsDigestState(db, {
      lastSentAt: delivered > 0 ? nowMs : (state.lastSentAt ?? nowMs),
      lastKey: key,
      configHash: hash,
    });
  }

  const poller = createPoller({
    intervalMs,
    runOnStart: false,
    run: runOnce,
    logger,
    errorLogMessage: 'stats digest: tick failed',
  });

  return {
    start: () => poller.start(),
    stop: () => poller.stop(),
    runOnce,
  };
}
