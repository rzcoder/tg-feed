/**
 * Public surface of the forwarding pipeline.
 *
 * `createForwardingPipeline` wires the default forwarder + throttle reader
 * against the live gramjs client and DB. Tests build the pipeline directly
 * via `new ForwardingPipeline(...)` with stubs.
 */
import type { Db } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import { createForwarder, type ForwarderClient } from './forwarder.js';
import { ForwardingPipeline } from './queue.js';
import { getGlobalDelayMs } from './throttle.js';

export type { ForwardJob, ForwardOutcome, ForwardingHandle } from './types.js';
export { ForwardingPipeline } from './queue.js';

export interface CreatePipelineDeps {
  client: ForwarderClient;
  db: Db;
  logger: Logger;
}

export function createForwardingPipeline(deps: CreatePipelineDeps): ForwardingPipeline {
  const forwarder = createForwarder({ client: deps.client, db: deps.db, logger: deps.logger });
  return new ForwardingPipeline({
    forwarder,
    getDelayMs: () => getGlobalDelayMs(deps.db),
    logger: deps.logger,
  });
}
