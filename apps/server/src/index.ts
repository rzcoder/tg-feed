// Listen before connecting Telegram: avoids a dev-proxy ECONNREFUSED race; bring-up is best-effort.
import './lib/loadEnv.js';
import process from 'node:process';
import type { TelegramClient } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import { requireWebAuthEnv } from './api/auth.js';
import { createApiServer } from './api/server.js';
import { createTgFeedBot, type TgFeedBot } from './bot/bot.js';
import { createStatsDigestScheduler } from './bot/statsDigest.js';
import { resolvePublicUrl, resolveTelegramAuth } from './bot/botConfig.js';
import { config } from './config.js';
import type { Db } from './db/client.js';
import { closeDb, getDb } from './db/client.js';
import type { EventBus } from './events/bus.js';
import { createEventBus } from './events/bus.js';
import {
  createDefaultRegistry,
  createFilterEvaluator,
  type FilterEvaluator,
} from './filters/index.js';
import {
  createAlbumDebouncer,
  createForwardingPipeline,
  getAlbumDebounceMs,
  type AlbumDebouncer,
  type ForwardingPipeline,
} from './forwarding/index.js';
import { createHistoryPoller, type HistoryPoller } from './forwarding/historyPoller.js';
import { createForwarderClient } from './forwarding/forwarderClient.js';
import { logger } from './lib/logger.js';
import { createPoller } from './lib/poller.js';
import { loadEncryptionKey } from './lib/sessionCrypto.js';
import { pruneForwardLog } from './forwarding/retention.js';
import { createSessionStore } from './api/sessionStore.js';
import { createAccessMonitor, type AccessMonitor } from './tg/accessMonitor.js';
import { createChatResolver, type ChatResolver } from './tg/chatResolver.js';
import { createForumTopicLister, type ForumTopicLister } from './tg/forumTopics.js';
import { createTelegramClient, disconnectClient, resolveTelegramEnv } from './tg/client.js';
import { createDialogsKeepalive, type DialogsKeepalive } from './tg/dialogsKeepalive.js';
import { createHealthMonitor, type HealthMonitor } from './tg/healthMonitor.js';
import { createImportInvite, type ImportInviteFn } from './tg/inviteResolver.js';
import { createJoinChannel, type JoinChannelFn } from './tg/joinChannel.js';
import { attachNewMessageListener } from './tg/listener.js';
import { createLoginSessionStore } from './tg/loginSession.js';
import { createProfilePhotoFetcher, type ProfilePhotoFetcher } from './tg/profilePhoto.js';
import { resolveSubscriptionsOnStartup } from './tg/subscriptions.js';

interface TelegramRuntime {
  client?: TelegramClient;
  pipeline?: ForwardingPipeline;
  debouncer?: AlbumDebouncer;
  historyPoller?: HistoryPoller;
  dialogsKeepalive?: DialogsKeepalive;
  chatResolver?: ChatResolver;
  importInvite?: ImportInviteFn;
  healthMonitor?: HealthMonitor;
  accessMonitor?: AccessMonitor;
  joinChannel?: JoinChannelFn;
  fetchProfilePhoto?: ProfilePhotoFetcher;
  listForumTopics?: ForumTopicLister;
  status: TelegramStatus;
}

interface TryStartTelegramDeps {
  db: Db;
  bus: EventBus;
  filterEvaluator: FilterEvaluator;
  isShuttingDown: () => boolean;
  setStatus: (next: TelegramStatus) => void;
  requestReload: () => Promise<void>;
}

async function tryStartTelegram(deps: TryStartTelegramDeps): Promise<TelegramRuntime> {
  const { db, bus, filterEvaluator, isShuttingDown, setStatus, requestReload } = deps;
  const tgEnvResult = resolveTelegramEnv({ cfg: config, db, logger });
  if (!tgEnvResult.ok) {
    logger.warn(
      { reason: tgEnvResult.reason },
      'Telegram disabled — booting in degraded mode (API + DB only)',
    );
    return {
      status: {
        state: 'disconnected',
        connected: false,
        reason: tgEnvResult.reason as string,
      },
    };
  }

  const CONNECT_TIMEOUT_MS = 120_000;

  let client: TelegramClient | undefined;
  try {
    client = createTelegramClient(tgEnvResult.env!);
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Telegram connect timed out')), CONNECT_TIMEOUT_MS),
      ),
    ]);
    if (isShuttingDown()) {
      try {
        await disconnectClient(client);
      } catch (secondaryErr) {
        logger.debug({ err: secondaryErr }, 'secondary error during early-shutdown teardown');
      }
      return {
        status: {
          state: 'disconnected',
          connected: false,
          reason: 'shutdown during Telegram init',
        },
      };
    }
    logger.info({ source: tgEnvResult.source }, 'connected to Telegram');
    // gramjs 2.26.x catchUp() is a stub: offline updates are lost; history poller is the backstop.
    logger.warn(
      'Telegram catch-up is not available in gramjs 2.26.x; messages delivered while offline will be missed',
    );
    const pipeline = createForwardingPipeline({
      client: createForwarderClient(client),
      db,
      logger,
      bus,
    });
    const debouncer = createAlbumDebouncer({
      downstream: pipeline,
      filterEvaluator,
      logger,
      getWindowMs: () => getAlbumDebounceMs(db),
    });
    attachNewMessageListener(client, db, logger, debouncer);
    await resolveSubscriptionsOnStartup(client, db, logger);
    // Backstop: gramjs silently stops delivering channel updates once a per-channel pts drifts.
    const historyPoller = createHistoryPoller({
      client,
      db,
      logger,
      forwarding: debouncer,
    });
    historyPoller.start();
    const dialogsKeepalive = createDialogsKeepalive({ client, logger });
    dialogsKeepalive.start();
    const chatResolver = createChatResolver(client);
    const importInvite = createImportInvite(client, logger);
    const joinChannel = createJoinChannel(client, logger);
    const fetchProfilePhoto = createProfilePhotoFetcher(client, logger);
    const listForumTopics = createForumTopicLister(client, logger);
    const healthMonitor = createHealthMonitor({
      client,
      logger,
      onStatusChange: (next) => setStatus(next),
      requestReload,
    });
    healthMonitor.start();
    const accessMonitor = createAccessMonitor({
      client,
      db,
      bus,
      logger,
      ...(fetchProfilePhoto !== undefined ? { fetchProfilePhoto } : {}),
    });
    accessMonitor.start();
    return {
      client,
      pipeline,
      debouncer,
      historyPoller,
      dialogsKeepalive,
      chatResolver,
      importInvite,
      joinChannel,
      fetchProfilePhoto,
      listForumTopics,
      healthMonitor,
      accessMonitor,
      status: { state: 'connected', connected: true },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown Telegram error';
    logger.error({ err }, 'Telegram init failed — booting in degraded mode');
    if (client) {
      try {
        await disconnectClient(client);
      } catch (secondaryErr) {
        logger.debug({ err: secondaryErr }, 'secondary error during Telegram client teardown');
      }
    }
    return { status: { state: 'disconnected', connected: false, reason } };
  }
}

// Dispose order matters: monitors/debouncer (timers) → pipeline (in-flight forwards) → gramjs client.
async function teardownRuntime(runtime: Partial<TelegramRuntime>): Promise<void> {
  if (runtime.dialogsKeepalive) {
    try {
      runtime.dialogsKeepalive.stop();
    } catch (err) {
      logger.debug({ err }, 'dialogsKeepalive stop failed');
    }
  }
  if (runtime.historyPoller) {
    try {
      runtime.historyPoller.stop();
    } catch (err) {
      logger.debug({ err }, 'historyPoller stop failed');
    }
  }
  if (runtime.accessMonitor) {
    try {
      runtime.accessMonitor.stop();
    } catch (err) {
      logger.debug({ err }, 'accessMonitor stop failed');
    }
  }
  if (runtime.healthMonitor) {
    try {
      runtime.healthMonitor.stop();
    } catch (err) {
      logger.debug({ err }, 'healthMonitor stop failed');
    }
  }
  if (runtime.debouncer) {
    try {
      runtime.debouncer.stop();
    } catch (err) {
      logger.debug({ err }, 'debouncer stop failed');
    }
  }
  if (runtime.pipeline) {
    try {
      await runtime.pipeline.stop();
    } catch (err) {
      logger.debug({ err }, 'pipeline stop failed');
    }
  }
  if (runtime.client) {
    try {
      await disconnectClient(runtime.client);
    } catch (err) {
      logger.debug({ err }, 'disconnectClient failed');
    }
  }
}

async function main(): Promise<void> {
  const webAuth = requireWebAuthEnv(config);
  const db = getDb();
  const bus = createEventBus({ logger });
  const filterRegistry = createDefaultRegistry();
  const filterEvaluator = createFilterEvaluator({ db, registry: filterRegistry, logger, bus });

  const tgRuntime: Partial<TelegramRuntime> = {};
  const statusRef: { current: TelegramStatus } = {
    current: {
      state: 'connecting',
      connected: false,
      reason: 'Telegram is starting up',
    },
  };
  let shuttingDown = false;
  const setStatus = (next: TelegramStatus): void => {
    statusRef.current = next;
  };

  const loginSessionStore = createLoginSessionStore({
    apiId: config.TG_API_ID ?? 0,
    apiHash: config.TG_API_HASH ?? '',
    logger,
  });

  // Mutex: coalesce concurrent reloads so two "Sign in" clicks don't race two clients in.
  let reloadPending: Promise<void> | null = null;

  async function reloadTelegramSession(): Promise<void> {
    if (shuttingDown) return;
    if (reloadPending) return reloadPending;
    reloadPending = (async () => {
      logger.info('reloading Telegram session');
      const oldRuntime: Partial<TelegramRuntime> = { ...tgRuntime };
      setStatus({
        state: 'connecting',
        connected: false,
        reason: 'reloading Telegram session',
      });
      const next = await tryStartTelegram({
        db,
        bus,
        filterEvaluator,
        isShuttingDown: () => shuttingDown,
        setStatus,
        requestReload: reloadTelegramSession,
      });
      // Clear first so unset keys on `next` actually drop old refs (e.g. resolver after sign-out).
      for (const key of Object.keys(tgRuntime) as (keyof TelegramRuntime)[]) {
        delete tgRuntime[key];
      }
      Object.assign(tgRuntime, next);
      setStatus(next.status);
      // Tear down after the swap so an in-flight handler sees the new value first.
      await teardownRuntime(oldRuntime);
      if (next.status.connected) {
        logger.info('Telegram session reloaded');
      } else {
        logger.warn(
          { reason: next.status.reason },
          'Telegram session reload landed in degraded mode',
        );
      }
    })();
    try {
      await reloadPending;
    } finally {
      reloadPending = null;
    }
  }

  let bot: TgFeedBot | undefined;
  let botReloadPending: Promise<void> | null = null;

  async function reloadBot(): Promise<void> {
    if (shuttingDown) return;
    if (botReloadPending) return botReloadPending;
    botReloadPending = (async () => {
      const auth = resolveTelegramAuth({ cfg: config, db, logger });
      const publicUrl = resolvePublicUrl({ cfg: config, db });
      // Stop the old bot FIRST: two getUpdates loops on the same token 409.
      const old = bot;
      bot = undefined;
      if (old) {
        try {
          await old.stop();
        } catch (err) {
          logger.debug({ err }, 'bot: stop during reload failed');
        }
      }
      if (!auth) {
        logger.info(
          'Telegram Web App bot disabled (set a token + admin id via Settings → Bot, or TG_BOT_TOKEN + TG_BOT_ADMIN_IDS)',
        );
        return;
      }
      const next = createTgFeedBot({
        token: auth.botToken,
        adminIds: auth.adminIds,
        publicUrl,
        logger,
      });
      try {
        await next.start();
        bot = next;
      } catch (err) {
        logger.error({ err }, 'bot: failed to start — continuing without it');
        bot = undefined;
      }
    })();
    try {
      await botReloadPending;
    } finally {
      botReloadPending = null;
    }
  }

  const sessionStore = createSessionStore({ db });

  const app = await createApiServer({
    db,
    logger,
    filterRegistry,
    webAuth,
    cfg: config,
    getTelegramAuth: () => resolveTelegramAuth({ cfg: config, db, logger }),
    reloadBot,
    getBotRunning: () => bot !== undefined,
    isProd: config.NODE_ENV === 'production',
    bus,
    getTelegramStatus: () => statusRef.current,
    getChatResolver: () => tgRuntime.chatResolver,
    getImportInvite: () => tgRuntime.importInvite,
    getJoinChannel: () => tgRuntime.joinChannel,
    getFetchProfilePhoto: () => tgRuntime.fetchProfilePhoto,
    getListForumTopics: () => tgRuntime.listForumTopics,
    getEncryptionKey: () => loadEncryptionKey(config),
    loginSessionStore,
    reloadTelegramSession,
    sessionStore,
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  logger.info({ port: config.PORT }, 'API listening');

  const prunePoller = createPoller({
    intervalMs: 60 * 60 * 1000,
    runOnStart: true,
    logger,
    errorLogMessage: 'prune task failed',
    run: async () => {
      pruneForwardLog({ db, logger });
      const expired = sessionStore.prune();
      if (expired > 0) logger.info({ expired }, 'pruned expired web sessions');
    },
  });
  prunePoller.start();

  // Best-effort: a failed bot start leaves the API serving (password login still works).
  await reloadBot();

  // getBot reads the live ref so the scheduler follows bot reloads.
  const statsDigest = createStatsDigestScheduler({ db, getBot: () => bot, logger });
  statsDigest.start();

  // Awaited from shutdown so we don't tear down half-attached resources.
  const tgInitPromise = (async () => {
    const tg = await tryStartTelegram({
      db,
      bus,
      filterEvaluator,
      isShuttingDown: () => shuttingDown,
      setStatus,
      requestReload: reloadTelegramSession,
    });
    if (shuttingDown) {
      await teardownRuntime(tg);
      return;
    }
    Object.assign(tgRuntime, tg);
    statusRef.current = tg.status;
    if (tg.client) {
      logger.info('Telegram subsystem ready');
    }
  })();
  tgInitPromise.catch((err) => {
    logger.error({ err }, 'background Telegram init crashed');
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      prunePoller.stop();
      statsDigest.stop();
      // Settle an in-flight bot reload first, else it can leave a poll loop running past SIGTERM.
      if (botReloadPending) await botReloadPending.catch(() => {});
      if (bot) await bot.stop();
      await app.close();
      // connect() takes no AbortSignal cleanly; wait for init (and any live-swap) to settle.
      await tgInitPromise.catch(() => {});
      if (reloadPending) await reloadPending.catch(() => {});
      await loginSessionStore.shutdown();
      await teardownRuntime(tgRuntime);
    } finally {
      closeDb();
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'fatal: failed to start tg-feed server');
  process.exit(1);
});
