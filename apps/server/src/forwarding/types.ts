/**
 * Shared types for the forwarding pipeline.
 *
 * `ForwardJob` is what the listener hands off; `ForwardOutcome` is what the
 * forwarder returns after a single attempt — its discriminator drives the
 * worker's retry/advance decision in `queue.ts`.
 */

export interface ForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  sourceMessageId: string;
}

export type ForwardOutcome =
  | { status: 'sent'; destMessageIds: string[] }
  | { status: 'flood_wait'; seconds: number }
  | { status: 'failed'; error: string };

export interface ForwardingHandle {
  enqueue(job: ForwardJob): void;
}
