/**
 * Auto-join helper used when a new subscription is created.
 *
 * The userbot only receives `NewMessage` events from chats it's a member
 * of. Adding a row to `subscriptions` doesn't change that on Telegram's
 * side, so without an explicit `channels.JoinChannel` invocation new
 * subscriptions to public channels would silently produce no traffic.
 *
 * Outcomes are coalesced into two states ('ok' | 'no_access') so the
 * caller can store a single column. We swallow gramjs errors here — the
 * caller wants to create the subscription regardless; the badge is the UI
 * signal that the operator needs to fix access manually.
 *
 * `JoinChannel` only applies to channels/supergroups (`-100xxx`). For user
 * or bot DMs and basic groups we fall back to a `getEntity` smoke test:
 * if the userbot can resolve the entity, it has access.
 */
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';

export type AccessProbeResult = 'ok' | 'no_access';
export type JoinChannelFn = (sourceChatId: string) => Promise<AccessProbeResult>;

// Subset of gramjs `TelegramClient` we depend on, so tests can pass a stub
// without standing up the full client.
export interface JoinChannelClient {
  getInputEntity: TelegramClient['getInputEntity'];
  getEntity: TelegramClient['getEntity'];
  invoke: TelegramClient['invoke'];
}

// Errors that mean "userbot can't access this chat" rather than a transient
// failure. Anything not in this list is logged at warn so unknown error
// shapes get diagnosed instead of silently classified.
const NO_ACCESS_PATTERNS: readonly RegExp[] = [
  /CHANNEL_PRIVATE/i,
  /CHANNEL_INVALID/i,
  /INVITE_HASH_(EXPIRED|INVALID|EMPTY)/i,
  /USERS_TOO_MUCH/i,
  /CHAT_ADMIN_REQUIRED/i,
  /USER_BANNED_IN_CHANNEL/i,
];

function errorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const obj = err as { errorMessage?: unknown; message?: unknown };
  if (typeof obj.errorMessage === 'string') return obj.errorMessage;
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

export function createJoinChannel(client: JoinChannelClient, logger: Logger): JoinChannelFn {
  return async (sourceChatId) => {
    // -100xxx is the supergroup/channel marker. Bot/user DMs and basic
    // groups can't be joined via channels.JoinChannel; for those we just
    // verify access exists.
    const isChannelLike = sourceChatId.startsWith('-100');
    if (!isChannelLike) {
      try {
        await client.getEntity(sourceChatId);
        return 'ok';
      } catch (err) {
        logger.warn(
          { err, sourceChatId },
          'getEntity failed for non-channel source on subscription create',
        );
        return 'no_access';
      }
    }

    let inputPeer: Api.TypeInputPeer;
    try {
      inputPeer = await client.getInputEntity(sourceChatId);
    } catch (err) {
      logger.warn({ err, sourceChatId }, 'getInputEntity failed on subscription create');
      return 'no_access';
    }
    if (!(inputPeer instanceof Api.InputPeerChannel)) {
      // -100xxx that resolved to something other than a channel — caller
      // passed a misclassified id. No JoinChannel is meaningful; report
      // no_access so the operator sees the mismatch in the UI.
      return 'no_access';
    }

    const channel = new Api.InputChannel({
      channelId: inputPeer.channelId,
      accessHash: inputPeer.accessHash,
    });

    try {
      await client.invoke(new Api.channels.JoinChannel({ channel }));
      return 'ok';
    } catch (err) {
      const msg = errorMessage(err);
      if (/USER_ALREADY_PARTICIPANT/i.test(msg)) return 'ok';
      if (NO_ACCESS_PATTERNS.some((p) => p.test(msg))) return 'no_access';
      logger.warn({ err, sourceChatId }, 'JoinChannel failed with unclassified error');
      return 'no_access';
    }
  };
}
