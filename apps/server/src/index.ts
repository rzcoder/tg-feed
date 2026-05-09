/**
 * @tg-feed/server — entrypoint.
 *
 * Boots the gramjs Telegram client, builds the forwarding pipeline,
 * registers a NewMessage listener that matches against saved subscriptions
 * and feeds matches into the pipeline, then resolves those subscriptions on
 * startup so stale ones surface as warnings.
 */
import 'dotenv/config';
import process from 'node:process';
import { config } from './config.js';
import { closeDb, getDb } from './db/client.js';
import { createAlbumDebouncer, createForwardingPipeline } from './forwarding/index.js';
import { logger } from './lib/logger.js';
import { createTelegramClient, disconnectClient, requireTelegramEnv } from './tg/client.js';
import { attachNewMessageListener } from './tg/listener.js';
import { resolveSubscriptionsOnStartup } from './tg/subscriptions.js';

async function main(): Promise<void> {
  const tgEnv = requireTelegramEnv(config);
  const client = createTelegramClient(tgEnv);

  await client.connect();
  logger.info('connected to Telegram');

  const db = getDb();
  const pipeline = createForwardingPipeline({ client, db, logger });
  const debouncer = createAlbumDebouncer({ downstream: pipeline, logger });
  attachNewMessageListener(client, db, logger, debouncer);
  await resolveSubscriptionsOnStartup(client, db, logger);

  logger.info('tg-feed server ready');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
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
