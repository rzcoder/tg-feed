/**
 * @tg-feed/server — entrypoint.
 *
 * Boots the gramjs Telegram client, builds the forwarding pipeline,
 * registers a NewMessage listener that matches against saved subscriptions
 * and feeds matches into the pipeline, resolves those subscriptions on
 * startup so stale ones surface as warnings, then starts the Fastify API
 * server so the web UI (Ch 9+) can manage configuration.
 *
 * Shutdown order is HTTP-first → debouncer → pipeline → Telegram → DB so
 * incoming requests get drained before the layers they depend on go away.
 */
import 'dotenv/config';
import process from 'node:process';
import { requireWebAuthEnv } from './api/auth.js';
import { createApiServer } from './api/server.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/client.js';
import { createDefaultRegistry, createFilterEvaluator } from './filters/index.js';
import { createAlbumDebouncer, createForwardingPipeline } from './forwarding/index.js';
import { logger } from './lib/logger.js';
import { createTelegramClient, disconnectClient, requireTelegramEnv } from './tg/client.js';
import { attachNewMessageListener } from './tg/listener.js';
import { resolveSubscriptionsOnStartup } from './tg/subscriptions.js';

async function main(): Promise<void> {
  const tgEnv = requireTelegramEnv(config);
  const webAuth = requireWebAuthEnv(config);
  const client = createTelegramClient(tgEnv);

  await client.connect();
  logger.info('connected to Telegram');

  const db = getDb();
  const filterRegistry = createDefaultRegistry();
  const filterEvaluator = createFilterEvaluator({ db, registry: filterRegistry, logger });
  const pipeline = createForwardingPipeline({ client, db, logger });
  const debouncer = createAlbumDebouncer({ downstream: pipeline, filterEvaluator, logger });
  attachNewMessageListener(client, db, logger, debouncer);
  await resolveSubscriptionsOnStartup(client, db, logger);

  logger.info('tg-feed server ready');

  const app = await createApiServer({
    db,
    logger,
    filterRegistry,
    webAuth,
    isProd: config.NODE_ENV === 'production',
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
      debouncer.stop();
      await pipeline.stop();
      await disconnectClient(client);
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
