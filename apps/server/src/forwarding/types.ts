// RawForwardJob = one per NewMessage; the album debouncer collapses raw jobs sharing a groupedId into one ForwardJob (singles become 1-element arrays).

export interface RawForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  // Forum top_msg_id; null/undefined = General / non-forum.
  destinationTopicId?: string | null;
  sourceMessageId: string;
  groupedId?: string;
  // Albums put the caption only on the first member, so filters run once per album, not per message (else they fragment).
  text: string;
  hasMedia: boolean;
  senderUsername?: string;
  // JSON-safe snapshot (via toJsonSafe); null when capture was skipped or over the size cap.
  rawMessage?: unknown;
}

export interface ForwardJob {
  subscriptionId: number;
  sourceChatId: string;
  destinationChatId: string;
  // Forum top_msg_id; null/undefined = General / non-forum.
  destinationTopicId?: string | null;
  sourceMessageIds: string[];
  // Album (≥2) = array of JSON-safe objects aligned with sourceMessageIds; single = plain object. Written to every batch row.
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
  | 'permanent_topic_unavailable'
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
