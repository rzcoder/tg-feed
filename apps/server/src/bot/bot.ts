import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Logger } from '../lib/logger.js';

export interface TgFeedBot {
  start(): Promise<void>;
  stop(): Promise<void>;
  // DMs `text` (HTML) to each admin, returning the success count; per-admin failures swallowed (often 403: admin never opened the bot).
  notifyAdmins(text: string): Promise<number>;
}

export interface CreateBotDeps {
  token: string;
  adminIds: string[];
  // Must be https to drive a Mini App.
  publicUrl?: string | undefined;
  logger: Logger;
}

const MENU_BUTTON_TEXT = 'Open tg-feed';

// Bounds each await in stop(): grammy's final getUpdates call has no timeout of its own.
const STOP_TIMEOUT_MS = 5000;

export function isBotAdmin(adminIds: string[], userId: number | string | undefined): boolean {
  if (userId === undefined) return false;
  return adminIds.includes(String(userId));
}

// A Mini App URL is only usable over HTTPS; anything else is rejected by Telegram.
export function resolveWebAppUrl(publicUrl: string | undefined): string | undefined {
  if (!publicUrl) return undefined;
  return publicUrl.startsWith('https://') ? publicUrl : undefined;
}

export function createTgFeedBot(deps: CreateBotDeps): TgFeedBot {
  const { token, adminIds, logger } = deps;
  const webAppUrl = resolveWebAppUrl(deps.publicUrl);
  const bot = new Bot(token);

  // Never rejects — a polling crash is logged in the `.catch` below.
  let pollLoop: Promise<void> | undefined;

  bot.catch((err) => {
    // Swallow per-update handler errors so one bad update doesn't stop polling.
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
      // Validates the token; a bad token rejects to the caller.
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

      // Not awaited: `bot.start()` resolves only when the bot stops.
      pollLoop = bot
        .start({
          onStart: (info) => logger.info({ username: info.username }, 'bot: started long-polling'),
        })
        .catch((err) => logger.error({ err }, 'bot: long-polling stopped with error'));
    },

    async notifyAdmins(text: string) {
      let delivered = 0;
      for (const id of adminIds) {
        try {
          await bot.api.sendMessage(Number(id), text, { parse_mode: 'HTML' });
          delivered += 1;
        } catch (err) {
          logger.warn({ err, adminId: id }, 'bot: failed to send admin notification');
        }
      }
      return delivered;
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

// Reject after `ms` if `p` hasn't settled; timer is unref'd.
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
