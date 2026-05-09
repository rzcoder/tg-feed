/**
 * @tg-feed/server — entrypoint.
 *
 * Will boot the gramjs Telegram client, the Fastify HTTP server,
 * and the internal event bus. Currently a placeholder; chapters 2+
 * fill this in (see docs/PLAN.md).
 */
import { SHARED_PACKAGE_VERSION } from '@tg-feed/shared';

async function main(): Promise<void> {
  console.log(`tg-feed server boot — shared@${SHARED_PACKAGE_VERSION}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
