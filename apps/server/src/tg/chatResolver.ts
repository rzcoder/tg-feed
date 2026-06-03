// Paste-anything chat resolver: @username, t.me/username, t.me/+HASH or +HASH invite, or numeric id.
// Not-yet-joined private invites return chatId=null with inviteHash set; create joins via ImportChatInvite.
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
  isForum: boolean;
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
        isForum: false, // unknown until joined; user sets topic later
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
        isForum: (entity as { forum?: boolean }).forum === true,
      };
    }

    // chatId branch: input already in storage form, so skip entityToResolved's prefix logic.
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
      forum?: boolean;
    };
    const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
    const title = e.title ?? (fullName !== '' ? fullName : parsed.value);
    return {
      chatId: parsed.value,
      title,
      handle: e.username ? `@${e.username}` : null,
      inviteHash: null,
      alreadyMember: true,
      isForum: e.forum === true,
    };
  };
}
