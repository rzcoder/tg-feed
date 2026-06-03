// `createForwardingPipeline` wires the live forwarder; tests build `ForwardingPipeline` with stubs.
import type { Db } from '../db/client.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../lib/logger.js';
import { createForwarder, recordForwardFailure, type ForwarderClient } from './forwarder.js';
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
export { createAlbumDebouncer, type AlbumDebouncer } from './albumDebouncer.js';
export {
  DEFAULT_ALBUM_DEBOUNCE_MS,
  DEFAULT_DELAY_MS,
  GLOBAL_SETTINGS_KEY,
  getAlbumDebounceMs,
  getGlobalDelayMs,
} from './throttle.js';

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
    onDeadLetter: (job) =>
      recordForwardFailure(
        { db: deps.db, logger: deps.logger, bus: deps.bus },
        job,
        'flood_wait_abandoned',
      ),
  });
}
