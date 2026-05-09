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
  /**
   * Filter-relevant content carried with the job so the album debouncer can
   * evaluate filters once per album (using the caption-bearing member) rather
   * than per source message — albums put the caption only on the first
   * message, so per-message text filtering would silently fragment them.
   */
  text: string;
  hasMedia: boolean;
  senderUsername?: string;
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
