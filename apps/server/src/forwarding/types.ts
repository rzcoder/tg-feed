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
  /**
   * JSON-safe snapshot of the source gramjs `Message` (already passed
   * through `toJsonSafe` at the capture boundary). Stored verbatim on the
   * `forward_log` row for later inspection. `null` when capture was skipped
   * or the encoded payload exceeded the size cap (caller stores `null`).
   */
  rawMessage?: unknown;
}

export interface ForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  sourceMessageIds: string[];
  /**
   * Raw message payloads, aligned with `sourceMessageIds`. For an album
   * (≥2 ids) this is an array of JSON-safe objects sorted to match
   * `sourceMessageIds`; for a single message it's a plain object. The
   * forwarder writes the whole value onto every inserted `forward_log`
   * row of the batch so each row is independently inspectable.
   */
  rawMessage?: unknown;
}

export type ForwardFailureKind =
  | 'transient'
  | 'permanent_chat_forwards_restricted'
  | 'permanent_message_id_invalid'
  | 'permanent_peer_id_invalid'
  | 'permanent_channel_private'
  | 'permanent_user_banned_in_channel'
  | 'permanent_chat_write_forbidden'
  | 'fatal_auth_key_unregistered';

export type ForwardOutcome =
  | { status: 'sent'; destMessageIds: string[] }
  | { status: 'flood_wait'; seconds: number; kind: 'flood_wait' | 'slow_mode' }
  | { status: 'failed'; error: string; failureKind: ForwardFailureKind };

export interface RawForwardingHandle {
  enqueue(raw: RawForwardJob): void;
}

export interface ForwardingHandle {
  enqueue(job: ForwardJob): void;
}
