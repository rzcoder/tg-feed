/**
 * Universal "paste-anything" chat resolver.
 *
 * Backs both `POST /api/subscriptions/resolve` and `POST /api/destinations/resolve`.
 * Accepts any of: `@username`, `t.me/username`, `t.me/+HASH` private invite,
 * `+HASH` raw invite, or a numeric chat id (`-100…` or bare positive).
 *
 * For private invites where the userbot is not yet a member, `chatId`
 * comes back `null` — only `inviteHash` is set, and the create endpoint
 * is expected to call `messages.ImportChatInvite` to actually join and
 * derive the resulting chatId.
 */
import type { TelegramClient } from 'telegram';
import { NotFoundError, UpstreamError } from '../lib/errors.js';
import { entityToResolved, parseInput } from './entityResolver.js';
import { checkInvite, type InviteClient } from './inviteResolver.js';

export interface ChatResolveResult {
  chatId: string | null;
  title: string;
  handle: string | null;
  inviteHash: string | null;
  alreadyMember: boolean;
}

export type ChatResolver = (input: string) => Promise<ChatResolveResult>;

export interface ChatResolverClient extends InviteClient {
  getEntity: TelegramClient['getEntity'];
}

interface GramJsErrorLike {
  errorMessage?: string;
  message?: string;
  code?: number;
}

const KNOWN_NOT_FOUND = /USERNAME_NOT_OCCUPIED|USERNAME_INVALID|PEER_ID_INVALID/i;
const KNOWN_PRIVATE = /CHANNEL_PRIVATE|CHANNEL_INVALID/i;

function classifyGetEntityError(err: unknown, label: string): never {
  const e = err as GramJsErrorLike;
  const msg = (e?.errorMessage ?? e?.message ?? '').toUpperCase();
  if (KNOWN_NOT_FOUND.test(msg)) {
    throw new NotFoundError(label);
  }
  if (KNOWN_PRIVATE.test(msg)) {
    throw new UpstreamError(`${label} is private or invalid`, 'private_channel');
  }
  throw new UpstreamError(`Telegram resolve failed for ${label}`);
}

export function createChatResolver(client: ChatResolverClient): ChatResolver {
  return async (input) => {
    const parsed = parseInput(input);

    if (parsed.kind === 'invite') {
      const preview = await checkInvite(client, parsed.hash);
      return {
        chatId: preview.chatId,
        title: preview.title,
        handle: null,
        inviteHash: parsed.hash,
        alreadyMember: preview.alreadyMember,
      };
    }

    if (parsed.kind === 'handle') {
      let entity: unknown;
      try {
        entity = await client.getEntity(parsed.value);
      } catch (err) {
        classifyGetEntityError(err, `channel @${parsed.value}`);
      }
      const resolved = entityToResolved(entity, parsed.value);
      return {
        chatId: resolved.sourceChatId,
        title: resolved.sourceTitle,
        handle: resolved.handle,
        inviteHash: null,
        alreadyMember: true,
      };
    }

    // chatId branch — verify access and pull the title via getEntity. The
    // input is already in the storage form (`-100xxx` or bare positive),
    // so we don't need entityToResolved's prefix logic here.
    let entity: unknown;
    try {
      entity = await client.getEntity(parsed.value);
    } catch (err) {
      classifyGetEntityError(err, `chat ${parsed.value}`);
    }
    const e = entity as {
      title?: string;
      firstName?: string;
      lastName?: string;
      username?: string;
    };
    const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
    const title = e.title ?? (fullName !== '' ? fullName : parsed.value);
    return {
      chatId: parsed.value,
      title,
      handle: e.username ? `@${e.username}` : null,
      inviteHash: null,
      alreadyMember: true,
    };
  };
}
