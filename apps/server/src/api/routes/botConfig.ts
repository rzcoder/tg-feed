// Token encrypted with TG_SESSION_ENCRYPTION_KEY (token write 412s without a key); GET is masked, never returns the token.
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
  // Supplies the env fallbacks behind the masked view.
  cfg: Config;
  db: Db;
  // 32-byte key, or null when unset.
  getEncryptionKey?: () => Buffer | null;
  reloadBot?: () => Promise<void>;
  getBotRunning?: () => boolean;
  // Lazy (populated after Telegram init), read per request; absent → 503.
  getChatResolver?: () => ChatResolver | undefined;
  // Picks the right 503: `initializing` vs `unavailable`.
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
      // Row is already saved; don't fail the save on a live-swap error (logged in reloadBot).
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
    // Admins are users (bare positive id); reject `-100…` channels/groups and null invites.
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
