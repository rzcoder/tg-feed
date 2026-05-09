/**
 * @tg-feed/server — entrypoint.
 *
 * Boots the gramjs Telegram client, registers a NewMessage listener that
 * matches against the saved subscriptions, and resolves those subscriptions
 * on startup so stale ones surface as warnings. Forwarding lives in Ch 4.
 */
import 'dotenv/config';
import process from 'node:process';
import { config } from './config.js';
import { closeDb, getDb } from './db/client.js';
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
  attachNewMessageListener(client, db, logger);
  await resolveSubscriptionsOnStartup(client, db, logger);

  logger.info('tg-feed server ready');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
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
