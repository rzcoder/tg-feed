/**
 * Shared types for the forwarding pipeline.
 *
 * Two job shapes flow through the system:
 *
 *   - `RawForwardJob` is what the listener produces — one per `NewMessage` event,
 *     carrying an optional `groupedId` for album members.
 *   - `ForwardJob` is what the pipeline consumes after the album debouncer has
 *     collapsed N raw jobs sharing a `groupedId` into one. Single messages
 *     become 1-element arrays.
 *
 * `ForwardOutcome`'s discriminator drives the worker's retry/advance decision
 * in `queue.ts`.
 */

export interface RawForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  sourceMessageId: string;
  groupedId?: string;
}

export interface ForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  sourceMessageIds: string[];
}

export type ForwardOutcome =
  | { status: 'sent'; destMessageIds: string[] }
  | { status: 'flood_wait'; seconds: number }
  | { status: 'failed'; error: string };

export interface RawForwardingHandle {
  enqueue(raw: RawForwardJob): void;
}

export interface ForwardingHandle {
  enqueue(job: ForwardJob): void;
}
