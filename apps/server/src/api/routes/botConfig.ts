/**
 * Bot configuration routes — Settings → Bot.
 *
 * GET    /api/config/bot                → masked state (sources, key status, botRunning)
 * PUT    /api/config/bot                → partial save (token / admins / publicUrl)
 * DELETE /api/config/bot                → clear the DB row, env fallback resumes
 * POST   /api/config/bot/resolve-admin  → resolve @username → user (preview, no write)
 *
 * The token is encrypted with `TG_SESSION_ENCRYPTION_KEY` before it touches
 * the DB, so a token write refuses with 412 when no key is configured (admins
 * and public URL are not gated). After any change `reloadBot()` live-swaps the
 * long-polling bot so the new config takes effect without a restart. The GET
 * payload is masked — it never returns the token, only whether one exists and
 * from where.
 *
 * `resolve-admin` turns a `@username` into a user id via the universal chat
 * resolver (rejecting channels/groups); the resolved `{ id, displayName,
 * username }` is then saved into `admins`.
 */
import type { FastifyInstance } from 'fastify';
import {
  type BotAdmin,
  type BotConfigDeleteResponse,
  type BotConfigInfo,
  type ResolveBotAdminResponse,
  type TelegramStatus,
  resolveBotAdminRequestSchema,
  updateBotConfigRequestSchema,
} from '@tg-feed/shared';
import { buildBotConfigInfo } from '../../bot/botConfig.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db/client.js';
import { clearBotConfig, writeBotConfig, type BotConfigPatch } from '../../db/botConfigRepo.js';
import { AppError, telegramUnavailableError } from '../../lib/errors.js';
import { BOT_TOKEN_AAD, encryptSecret } from '../../lib/sessionCrypto.js';
import type { ChatResolver } from '../../tg/chatResolver.js';

export interface RegisterBotConfigRoutesDeps {
  /** Parsed env config — supplies the env fallbacks behind the masked view. */
  cfg: Config;
  db: Db;
  /** Returns the configured 32-byte key, or null when unset. */
  getEncryptionKey?: () => Buffer | null;
  /** Live-swaps the bot so a saved config takes effect immediately. */
  reloadBot?: () => Promise<void>;
  /** Whether the long-polling bot is currently running. */
  getBotRunning?: () => boolean;
  /**
   * Lazy lookup for the universal chat resolver — reused by `resolve-admin`
   * to turn a `@username` into a user id. Read per request (populated after
   * Telegram init). When absent, the route returns 503.
   */
  getChatResolver?: () => ChatResolver | undefined;
  /** Telegram lifecycle — picks the right 503 (`initializing` vs `unavailable`). */
  getTelegramStatus: () => TelegramStatus;
}

function dedupeAdmins(admins: BotAdmin[]): BotAdmin[] {
  const seen = new Set<string>();
  const out: BotAdmin[] = [];
  for (const a of admins) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

export function registerBotConfigRoutes(
  app: FastifyInstance,
  deps: RegisterBotConfigRoutesDeps,
): void {
  const { cfg, db, getEncryptionKey, reloadBot } = deps;
  const getBotRunning = deps.getBotRunning ?? ((): boolean => false);

  const info = (): BotConfigInfo =>
    buildBotConfigInfo({
      cfg,
      db,
      ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
      getBotRunning,
    });

  app.get('/config/bot', async (): Promise<BotConfigInfo> => info());

  app.put('/config/bot', async (request): Promise<BotConfigInfo> => {
    const body = updateBotConfigRequestSchema.parse(request.body);
    const patch: BotConfigPatch = {};

    if (body.token !== undefined) {
      if (body.token === null) {
        patch.token = null;
      } else {
        const key = getEncryptionKey?.() ?? null;
        if (!key) {
          throw new AppError(
            412,
            'encryption_key_missing',
            'TG_SESSION_ENCRYPTION_KEY is not configured',
          );
        }
        patch.token = encryptSecret(body.token, key, BOT_TOKEN_AAD);
      }
    }
    if (body.admins !== undefined) {
      patch.admins = body.admins === null ? null : dedupeAdmins(body.admins);
    }
    if (body.publicUrl !== undefined) {
      patch.publicUrl = body.publicUrl;
    }

    writeBotConfig(db, patch);
    if (reloadBot) {
      // Live-swap failures are logged inside `reloadBot`; the row is already
      // saved, so the next restart picks it up. Don't fail the save.
      await reloadBot().catch(() => {});
    }
    return info();
  });

  app.delete('/config/bot', async (): Promise<BotConfigDeleteResponse> => {
    clearBotConfig(db);
    if (reloadBot) {
      await reloadBot().catch(() => {});
    }
    return { ok: true };
  });

  app.post('/config/bot/resolve-admin', async (request): Promise<ResolveBotAdminResponse> => {
    const chatResolver = deps.getChatResolver?.();
    if (!chatResolver) {
      throw telegramUnavailableError(deps.getTelegramStatus());
    }
    const body = resolveBotAdminRequestSchema.parse(request.body);
    const resolved = await chatResolver(body.query);
    // Admins are *users* — a bare positive id. Channels/supergroups resolve to
    // a `-100…` id and unjoined private invites to null; reject both.
    if (!resolved.chatId || resolved.chatId.startsWith('-')) {
      throw new AppError(
        422,
        'not_a_user',
        "That resolves to a channel or group, not a user. Enter a person's @username or numeric id.",
      );
    }
    return {
      id: resolved.chatId,
      displayName: resolved.title,
      username: resolved.handle ? resolved.handle.replace(/^@/, '') : null,
    };
  });
}
