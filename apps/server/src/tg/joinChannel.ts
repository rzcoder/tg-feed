// Auto-join on subscription create: the userbot only gets NewMessage from chats it's a member of, so public channels need an explicit JoinChannel or they produce no traffic. Errors coalesce to 'ok' | 'no_access'; non-channels fall back to a getEntity access probe.
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';

export type AccessProbeResult = 'ok' | 'no_access';
export type JoinChannelFn = (sourceChatId: string) => Promise<AccessProbeResult>;

// Subset of gramjs TelegramClient we depend on, so tests can stub it.
export interface JoinChannelClient {
  getInputEntity: TelegramClient['getInputEntity'];
  getEntity: TelegramClient['getEntity'];
  invoke: TelegramClient['invoke'];
}

// "Can't access this chat" errors; anything else is logged at warn, not silently classified.
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
    // -100xxx = channel/supergroup; DMs and basic groups can't JoinChannel, just probe access.
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
      // -100xxx that resolved to a non-channel: misclassified id, surface the mismatch.
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
