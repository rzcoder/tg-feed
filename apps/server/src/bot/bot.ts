/**
 * Telegram bot (Bot API via grammy) that fronts the web client.
 *
 * Responsibilities today:
 *   - Answer `/start` (for admins) with a button that opens the web client as
 *     a Telegram Mini App.
 *   - Install a persistent chat menu button pointing at the same Mini App, so
 *     the client is one tap away next to the message input.
 *   - Refuse non-admins.
 *
 * This is deliberately thin — the in-app auth happens in
 * `api/routes/auth.ts` via `initData` verification, not here. Later chapters
 * will hang subscription-management commands off this same bot (the admin
 * guard and grammy instance are already in place for that).
 *
 * Lifecycle mirrors the gramjs runtime: `start()` is best-effort (the caller
 * boots the API regardless), long-polling runs in the background, and
 * `stop()` is awaited on shutdown. Telegram Mini Apps require HTTPS, so the
 * Web App button is only wired when `publicUrl` is an `https://` URL;
 * otherwise the bot still answers `/start` with a setup hint.
 */
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Logger } from '../lib/logger.js';

export interface TgFeedBot {
  /** Configure commands/menu button, then start long-polling in the background. */
  start(): Promise<void>;
  /** Stop long-polling. Idempotent enough for the shutdown path. */
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

  bot.catch((err) => {
    // grammy wraps handler errors; log and swallow so a single bad update
    // never tears down the poll loop.
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
      // `init()` fetches bot info and validates the token; let a bad token
      // throw to the best-effort caller in index.ts.
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

      // Long-poll in the background. `bot.start()` resolves only when the bot
      // stops, so we intentionally don't await it; errors surface via the
      // attached catch.
      void bot
        .start({
          onStart: (info) => logger.info({ username: info.username }, 'bot: started long-polling'),
        })
        .catch((err) => logger.error({ err }, 'bot: long-polling stopped with error'));
    },

    async stop() {
      try {
        await bot.stop();
      } catch (err) {
        logger.debug({ err }, 'bot: stop failed');
      }
    },
  };
}
