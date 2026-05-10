/**
 * @tg-feed/server — entrypoint.
 *
 * Boots the gramjs Telegram client, builds the forwarding pipeline,
 * registers a NewMessage listener that matches against saved subscriptions
 * and feeds matches into the pipeline, resolves those subscriptions on
 * startup so stale ones surface as warnings, then starts the Fastify API
 * server so the web UI (Ch 9+) can manage configuration.
 *
 * Telegram bring-up is best-effort: if env vars are missing or the connect
 * step fails, the API still boots in a degraded mode (no listener, no
 * forwarder, no entity resolver). `GET /api/system/status` exposes the
 * reason so the web UI can warn the operator. This lets the UI be
 * developed/smoke-tested without a real Telegram session.
 *
 * Shutdown order is HTTP-first → debouncer → pipeline → Telegram → DB so
 * incoming requests get drained before the layers they depend on go away.
 */
import './lib/loadEnv.js';
import process from 'node:process';
import type { TelegramClient } from 'telegram';
import type { TelegramStatus } from '@tg-feed/shared';
import { requireWebAuthEnv } from './api/auth.js';
import { createApiServer } from './api/server.js';
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
  type AlbumDebouncer,
  type ForwardingPipeline,
} from './forwarding/index.js';
import { logger } from './lib/logger.js';
import { createTelegramClient, disconnectClient, readTelegramEnv } from './tg/client.js';
import { createEntityResolver, type EntityResolver } from './tg/entityResolver.js';
import { attachNewMessageListener } from './tg/listener.js';
import { resolveSubscriptionsOnStartup } from './tg/subscriptions.js';

interface TelegramRuntime {
  client?: TelegramClient;
  pipeline?: ForwardingPipeline;
  debouncer?: AlbumDebouncer;
  entityResolver?: EntityResolver;
  status: TelegramStatus;
}

interface TryStartTelegramDeps {
  db: Db;
  bus: EventBus;
  filterEvaluator: FilterEvaluator;
}

async function tryStartTelegram(deps: TryStartTelegramDeps): Promise<TelegramRuntime> {
  const { db, bus, filterEvaluator } = deps;
  const tgEnvResult = readTelegramEnv(config);
  if (!tgEnvResult.ok) {
    logger.warn(
      { reason: tgEnvResult.reason },
      'Telegram disabled — booting in degraded mode (API + DB only)',
    );
    return { status: { connected: false, reason: tgEnvResult.reason as string } };
  }

  let client: TelegramClient | undefined;
  try {
    client = createTelegramClient(tgEnvResult.env!);
    await client.connect();
    logger.info('connected to Telegram');
    const pipeline = createForwardingPipeline({ client, db, logger, bus });
    const debouncer = createAlbumDebouncer({ downstream: pipeline, filterEvaluator, logger });
    attachNewMessageListener(client, db, logger, debouncer);
    await resolveSubscriptionsOnStartup(client, db, logger);
    const entityResolver = createEntityResolver(client);
    return {
      client,
      pipeline,
      debouncer,
      entityResolver,
      status: { connected: true },
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
    return { status: { connected: false, reason } };
  }
}

async function main(): Promise<void> {
  const webAuth = requireWebAuthEnv(config);
  const db = getDb();
  const bus = createEventBus({ logger });
  const filterRegistry = createDefaultRegistry();
  const filterEvaluator = createFilterEvaluator({ db, registry: filterRegistry, logger, bus });

  const tg = await tryStartTelegram({ db, bus, filterEvaluator });

  logger.info('tg-feed server ready');

  const app = await createApiServer({
    db,
    logger,
    filterRegistry,
    webAuth,
    isProd: config.NODE_ENV === 'production',
    bus,
    telegramStatus: tg.status,
    ...(tg.entityResolver !== undefined ? { entityResolver: tg.entityResolver } : {}),
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  logger.info({ port: config.PORT }, 'API listening');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      if (tg.debouncer) tg.debouncer.stop();
      if (tg.pipeline) await tg.pipeline.stop();
      if (tg.client) await disconnectClient(tg.client);
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
