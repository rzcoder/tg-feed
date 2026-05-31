/**
 * @tg-feed/server — entrypoint.
 *
 * Boots the API listener first, then brings the gramjs Telegram client up
 * in the background. The forwarding pipeline (NewMessage listener →
 * debouncer → pipeline) and the chat-resolver / invite / join / profile
 * fetcher helpers are attached to a mutable runtime box once the gramjs
 * `client.connect()` finishes. The Fastify factory reads tg-deps via
 * lazy getters, so route handlers pick up the post-init values without
 * re-registration. This eliminates a `pnpm -r --parallel dev` race where
 * Vite's proxy hit ECONNREFUSED before the server reached `app.listen()`.
 *
 * Telegram bring-up is best-effort: if env vars are missing or the connect
 * step fails, the API still serves in a degraded mode (no listener, no
 * forwarder, no entity resolver). `GET /api/system/status` exposes the
 * lifecycle phase ('connecting' / 'connected' / 'disconnected') so the web
 * UI can distinguish "starting up" from "configure your Telegram session".
 *
 * Shutdown order is HTTP-first → wait for in-flight Telegram init → tear
 * down debouncer / pipeline / Telegram / DB. We wait for the init promise
 * to settle because gramjs `client.connect()` doesn't accept an AbortSignal
 * cleanly; cancelling mid-flight risks orphaned sockets.
 */
import './lib/loadEnv.js';
import process from 'node:process';
import type { TelegramClient } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import { requireWebAuthEnv } from './api/auth.js';
import { createApiServer } from './api/server.js';
import { createTgFeedBot, type TgFeedBot } from './bot/bot.js';
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
import { logger } from './lib/logger.js';
import { createPoller } from './lib/poller.js';
import { loadEncryptionKey } from './lib/sessionCrypto.js';
import { pruneForwardLog } from './forwarding/retention.js';
import { createSessionStore } from './api/sessionStore.js';
import { createAccessMonitor, type AccessMonitor } from './tg/accessMonitor.js';
import { createChatResolver, type ChatResolver } from './tg/chatResolver.js';
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
  status: TelegramStatus;
}

interface TryStartTelegramDeps {
  db: Db;
  bus: EventBus;
  filterEvaluator: FilterEvaluator;
  /**
   * Returns true if a SIGINT/SIGTERM landed while we were inside
   * `client.connect()`. The function bails after connect with the client
   * disconnected so we don't attach a NewMessage listener that nothing will
   * tear down.
   */
  isShuttingDown: () => boolean;
  /**
   * Sink for status updates emitted by the health monitor. The boot path
   * funnels these into `statusRef.current` so `/api/system/status` reflects
   * runtime liveness changes (connected → disconnected, etc).
   */
  setStatus: (next: TelegramStatus) => void;
  /**
   * Forced session-reload callback. Passed into the health monitor so it
   * can recover from gramjs getting stuck in a reconnect loop. The function
   * is `reloadTelegramSession` from `main()`, which coalesces concurrent
   * calls and atomically swaps the runtime box.
   */
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
      // SIGINT/SIGTERM landed mid-connect. Bail before we attach the
      // listener — main()'s shutdown handler awaits this promise so
      // it'll just see a disconnected status and skip teardown of the
      // listener / pipeline.
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
    // gramjs 2.26.x ships `client.catchUp()` as a TODO stub (see
    // node_modules/telegram/client/updates.js — empty body) and does not
    // call `updates.getDifference` automatically on reconnect. As a result
    // any NewMessage events delivered while the process was offline are
    // permanently lost. Surface this as a warning so operators don't
    // assume restarts are transparent. A future change can poll
    // messages.getHistory per subscription on boot to backfill, gated on a
    // per-subscription `last_seen_message_id` column.
    logger.warn(
      'Telegram catch-up is not available in gramjs 2.26.x; messages delivered while offline will be missed',
    );
    const pipeline = createForwardingPipeline({ client, db, logger, bus });
    const debouncer = createAlbumDebouncer({
      downstream: pipeline,
      filterEvaluator,
      logger,
      getWindowMs: () => getAlbumDebounceMs(db),
    });
    attachNewMessageListener(client, db, logger, debouncer);
    await resolveSubscriptionsOnStartup(client, db, logger);
    // Polling backstop: catches messages the live `NewMessage` stream misses.
    // gramjs 2.26.x has no working `catchUp()` and silently stops delivering
    // channel updates once a per-channel pts drifts, so a periodic
    // `messages.getHistory` sweep is the only way to guarantee we see new
    // posts from every subscribed channel. See historyPoller.ts for details.
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
        // Already failing the primary path; don't let teardown throw,
        // but record at debug so post-mortem isn't blind.
        logger.debug({ err: secondaryErr }, 'secondary error during Telegram client teardown');
      }
    }
    return { status: { state: 'disconnected', connected: false, reason } };
  }
}

/**
 * Stop and dispose a Telegram runtime in the order that avoids dangling
 * references: monitors first (they hold timers), then the debouncer (timers),
 * then the pipeline (in-flight forwards), then the gramjs client itself.
 */
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

  // Mutable runtime box. Populated once Telegram bring-up finishes; the
  // Fastify routes read these via getter closures (see createApiServer
  // below) so they always see the current value without needing
  // re-registration when the background init completes.
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

  // Singleton store for in-progress sign-ins from the Settings page. Holds
  // temp gramjs clients between HTTP steps; GC sweeps stale entries every
  // minute. Shut down with the rest of the app on SIGINT/SIGTERM.
  const loginSessionStore = createLoginSessionStore({
    apiId: config.TG_API_ID ?? 0,
    apiHash: config.TG_API_HASH ?? '',
    logger,
  });

  // Live-swap mutex. Coalesces concurrent reload requests so two clicks of
  // "Sign in" don't race two new clients into the runtime box. Shutdown
  // awaits the current pending promise (if any) before tearing down.
  let reloadPending: Promise<void> | null = null;

  async function reloadTelegramSession(): Promise<void> {
    if (shuttingDown) return;
    if (reloadPending) return reloadPending;
    reloadPending = (async () => {
      logger.info('reloading Telegram session');
      const oldRuntime: Partial<TelegramRuntime> = { ...tgRuntime };
      // Mark transient state so /system/status reflects the swap window.
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
      // Replace refs in the box. Any unset keys on `next` clear the old
      // value (so e.g. degraded mode after a sign-out actually drops the
      // chat resolver).
      for (const key of Object.keys(tgRuntime) as (keyof TelegramRuntime)[]) {
        delete tgRuntime[key];
      }
      Object.assign(tgRuntime, next);
      setStatus(next.status);
      // Tear down old refs after the swap so any in-flight route handler
      // dereferencing the live getter sees the new value first.
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

  // Telegram Web App bot. Held in a mutable `bot` ref + a reload mutex so the
  // bot-config route can live-swap it (new token / admin ids / public URL)
  // without a restart.
  let bot: TgFeedBot | undefined;
  let botReloadPending: Promise<void> | null = null;

  async function reloadBot(): Promise<void> {
    if (shuttingDown) return;
    if (botReloadPending) return botReloadPending;
    botReloadPending = (async () => {
      const auth = resolveTelegramAuth({ cfg: config, db, logger });
      const publicUrl = resolvePublicUrl({ cfg: config, db });
      // Stop the old bot FIRST: grammy long-polls and two getUpdates loops on
      // the same token would 409. A brief no-bot window is acceptable.
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

  // DB-backed session store. Shared with the Fastify factory so both the
  // login route and the prune task see the same set of rows.
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
    getEncryptionKey: () => loadEncryptionKey(config),
    loginSessionStore,
    reloadTelegramSession,
    sessionStore,
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  logger.info({ port: config.PORT }, 'API listening');

  // Background pruner: keeps `forward_log` bounded and reaps expired web
  // sessions. One hour cadence is plenty — neither table changes fast enough
  // to justify aggressive ticking, and a single sweep is cheap.
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

  // Telegram Web App bot — best-effort: a failed start leaves the API serving
  // (password login still works). Started after `listen()`. `reloadBot`
  // resolves the config DB-over-env and starts the bot when one is configured.
  await reloadBot();

  // Background Telegram bring-up. Errors are caught inside
  // tryStartTelegram; the outer .catch is a belt-and-suspenders for any
  // throw that escapes (e.g. a logger crash). The promise is awaited from
  // the shutdown handler so we don't tear down half-attached resources.
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
      // Shutdown ran while we were connecting. Tear down what we built
      // (tryStartTelegram's own early-shutdown branch already handled the
      // pre-listener case; this path catches a SIGINT that landed *after*
      // connect returned but before we got here).
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
      // Let any in-flight bot reload settle before stopping the bot, so a
      // reload triggered moments before SIGTERM can't leave a poll loop running.
      if (botReloadPending) await botReloadPending.catch(() => {});
      if (bot) await bot.stop();
      await app.close();
      // gramjs client.connect() doesn't accept an AbortSignal cleanly, so
      // wait for the in-flight init to settle before tearing down its
      // outputs. Bounded by Telegram's internal connect timeout.
      await tgInitPromise.catch(() => {});
      // Same for any in-flight live-swap.
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
