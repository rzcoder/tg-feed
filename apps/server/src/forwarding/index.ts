/**
 * Public surface of the forwarding pipeline.
 *
 * `createForwardingPipeline` wires the default forwarder + throttle reader
 * against the live gramjs client and DB. Tests build the pipeline directly
 * via `new ForwardingPipeline(...)` with stubs.
 */
import type { Db } from '../db/client.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import { createForwarder, type ForwarderClient } from './forwarder.js';
import { ForwardingPipeline } from './queue.js';
import { getGlobalDelayMs } from './throttle.js';

export type {
  ForwardJob,
  ForwardOutcome,
  ForwardingHandle,
  RawForwardJob,
  RawForwardingHandle,
} from './types.js';
export { ForwardingPipeline } from './queue.js';
export { ALBUM_DEBOUNCE_MS, createAlbumDebouncer, type AlbumDebouncer } from './albumDebouncer.js';

export interface CreatePipelineDeps {
  client: ForwarderClient;
  db: Db;
  logger: Logger;
  bus: EventBus;
}

export function createForwardingPipeline(deps: CreatePipelineDeps): ForwardingPipeline {
  const forwarder = createForwarder({
    client: deps.client,
    db: deps.db,
    logger: deps.logger,
    bus: deps.bus,
  });
  return new ForwardingPipeline({
    forwarder,
    getDelayMs: () => getGlobalDelayMs(deps.db),
    logger: deps.logger,
  });
}
