/**
 * Telegram bot (Bot API via grammy) fronting the web client.
 *
 * Handles `/start`: replies to admins with a button that opens the web client
 * as a Telegram Mini App and installs a persistent chat menu button to the
 * same Mini App; refuses non-admins. In-app authentication is handled
 * separately in `api/routes/auth.ts`.
 *
 * `start()` configures the bot and runs long-polling in the background;
 * `stop()` tears it down. The Web App button requires an `https://` public
 * URL; without one, `/start` replies with a setup hint instead.
 */
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Logger } from '../lib/logger.js';

export interface TgFeedBot {
  /** Configure commands + menu button and start long-polling in the background. */
  start(): Promise<void>;
  /** Stop long-polling and wait for the poll loop to unwind. */
  stop(): Promise<void>;
}

export interface CreateBotDeps {
  token: string;
  adminIds: string[];
  /** Public base URL of the web client. Must be https to drive a Mini App. */
  publicUrl?: string | undefined;
  logger: Logger;
}

const MENU_BUTTON_TEXT = 'Open tg-feed';

// Timeout for each await in `stop()` — grammy's `stop()` makes a final
// `getUpdates` call that has no timeout of its own.
const STOP_TIMEOUT_MS = 5000;

/** Whether the update's sender is on the admin allowlist. */
export function isBotAdmin(adminIds: string[], userId: number | string | undefined): boolean {
  if (userId === undefined) return false;
  return adminIds.includes(String(userId));
}

/** A Mini App URL is only usable over HTTPS; anything else is rejected by Telegram. */
export function resolveWebAppUrl(publicUrl: string | undefined): string | undefined {
  if (!publicUrl) return undefined;
  return publicUrl.startsWith('https://') ? publicUrl : undefined;
}

export function createTgFeedBot(deps: CreateBotDeps): TgFeedBot {
  const { token, adminIds, logger } = deps;
  const webAppUrl = resolveWebAppUrl(deps.publicUrl);
  const bot = new Bot(token);

  // Long-poll promise; `stop()` awaits it for teardown. Never rejects — a
  // polling crash is logged in the `.catch` below.
  let pollLoop: Promise<void> | undefined;

  bot.catch((err) => {
    // Log and swallow per-update handler errors so one bad update doesn't stop polling.
    logger.error(
      { err: err.error, update: err.ctx.update.update_id },
      'bot: update handler failed',
    );
  });

  bot.command('start', async (ctx: Context) => {
    if (!isBotAdmin(adminIds, ctx.from?.id)) {
      await ctx.reply('⛔ This bot is private. Your Telegram account is not authorized.');
      logger.warn({ telegramUserId: ctx.from?.id }, 'bot: /start from non-admin');
      return;
    }
    if (!webAppUrl) {
      await ctx.reply(
        'tg-feed is running, but no public HTTPS URL is configured.\n' +
          'Set PUBLIC_URL on the server (https://…) to open the web client here.',
      );
      return;
    }
    const keyboard = new InlineKeyboard().webApp(MENU_BUTTON_TEXT, webAppUrl);
    await ctx.reply('Open the tg-feed console:', { reply_markup: keyboard });
  });

  return {
    async start() {
      // Fetch bot info and validate the token; a bad token rejects to the caller.
      await bot.init();

      try {
        await bot.api.setMyCommands([{ command: 'start', description: 'Open tg-feed' }]);
      } catch (err) {
        logger.warn({ err }, 'bot: failed to set commands');
      }

      if (webAppUrl) {
        try {
          await bot.api.setChatMenuButton({
            menu_button: {
              type: 'web_app',
              text: MENU_BUTTON_TEXT,
              web_app: { url: webAppUrl },
            },
          });
        } catch (err) {
          logger.warn({ err }, 'bot: failed to set chat menu button');
        }
      } else {
        logger.warn(
          'bot: PUBLIC_URL is unset or not https — Mini App button disabled (set PUBLIC_URL to enable)',
        );
      }

      // Run long-polling in the background; `bot.start()` resolves only when
      // the bot stops, so it's not awaited here. `bot.init()` ran above, so
      // grammy marks the bot running synchronously on this call.
      pollLoop = bot
        .start({
          onStart: (info) => logger.info({ username: info.username }, 'bot: started long-polling'),
        })
        .catch((err) => logger.error({ err }, 'bot: long-polling stopped with error'));
    },

    async stop() {
      try {
        await withTimeout(bot.stop(), STOP_TIMEOUT_MS);
      } catch (err) {
        logger.debug({ err }, 'bot: stop failed or timed out');
      }
      // Wait for the poll loop to unwind so no getUpdates is left in flight.
      if (pollLoop) {
        try {
          await withTimeout(pollLoop, STOP_TIMEOUT_MS);
        } catch (err) {
          logger.debug({ err }, 'bot: poll loop did not unwind in time');
        }
      }
    },
  };
}

/** Settle with `p`, or reject after `ms` if it hasn't settled. Timer is unref'd. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
