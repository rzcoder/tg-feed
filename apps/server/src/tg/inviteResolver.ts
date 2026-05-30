/**
 * gramjs wrappers for `messages.CheckChatInvite` (preview) and
 * `messages.ImportChatInvite` (actually join).
 *
 * The check call is non-destructive — we use it from the resolve endpoint
 * to show the user a preview card before they commit. The import call is
 * destructive (joins the chat) — used from the create endpoint after the
 * user confirms.
 *
 * For `ChatInvite` (not yet a member) the preview carries the title but no
 * chatId — only `ImportChatInvite` returns the chat. The resolve flow
 * surfaces `chatId: null` in that case and forwards the raw hash to the
 * create endpoint.
 *
 * Errors are mapped to the typed `AppError` hierarchy for `checkInvite`
 * (so the resolve endpoint propagates 4xx/5xx with stable codes), and
 * coalesced into `'no_access'` for the import path (matching the
 * `joinChannel` pattern — the create endpoint wants a single decision bit).
 */
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import { NotFoundError, UpstreamError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export interface InviteClient {
  invoke: TelegramClient['invoke'];
}

export interface InvitePreview {
  /** null when the userbot is not yet a member (`ChatInvite`). */
  chatId: string | null;
  title: string;
  alreadyMember: boolean;
}

export interface InviteJoinResult {
  status: 'ok' | 'no_access';
  chatId: string | null;
  title: string | null;
}

export type ImportInviteFn = (hash: string) => Promise<InviteJoinResult>;

interface GramJsErrorLike {
  errorMessage?: string;
  message?: string;
  code?: number;
}

function errorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const obj = err as GramJsErrorLike;
  return (obj.errorMessage ?? obj.message ?? '').toString();
}

const NOT_FOUND_PATTERNS = /INVITE_HASH_(EXPIRED|INVALID|EMPTY)/i;
const PRIVATE_PATTERNS =
  /CHANNEL_PRIVATE|USER_BANNED_IN_CHANNEL|USERS_TOO_MUCH|CHAT_ADMIN_REQUIRED/i;

/**
 * Convert a chat-shaped object (from `ChatInviteAlready.chat`,
 * `ChatInvitePeek.chat`, or an entry in `Updates.chats[]`) into the
 * `-100`-prefixed string the rest of the system uses. Mirrors the rule in
 * `entityResolver.entityToResolved` so invite-derived ids match
 * `-100`-prefixed ids stored elsewhere.
 */
export function chatIdFromInviteChat(chat: unknown): string | null {
  if (!chat || typeof chat !== 'object') return null;
  const c = chat as { id?: { toString: () => string } | number | string; className?: string };
  if (c.id === undefined || c.id === null) return null;
  const idStr = typeof c.id === 'object' ? c.id.toString() : String(c.id);
  const className = c.className ?? '';
  if (className === 'Channel' || className === 'Chat') {
    return idStr.startsWith('-') ? idStr : `-100${idStr}`;
  }
  return idStr;
}

function chatTitle(chat: unknown): string {
  if (!chat || typeof chat !== 'object') return '';
  const c = chat as { title?: string };
  return c.title ?? '';
}

// Invite hashes are bearer credentials — anyone with the full string can join
// the chat (subject to expiry/usage limits). Logs may be shipped to external
// systems; only the first 6 chars survive so the operator can still correlate
// without leaking the credential.
function redactInviteHash(hash: string): string {
  if (hash.length <= 6) return '***';
  return `${hash.slice(0, 6)}…`;
}

export async function checkInvite(client: InviteClient, hash: string): Promise<InvitePreview> {
  let result: Api.TypeChatInvite;
  try {
    result = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
  } catch (err) {
    classifyCheckError(err);
  }

  if (result instanceof Api.ChatInviteAlready) {
    return {
      chatId: chatIdFromInviteChat(result.chat),
      title: chatTitle(result.chat),
      alreadyMember: true,
    };
  }
  if (result instanceof Api.ChatInvitePeek) {
    return {
      chatId: chatIdFromInviteChat(result.chat),
      title: chatTitle(result.chat),
      // Peek means we can read but haven't joined as a full participant.
      alreadyMember: false,
    };
  }
  if (result instanceof Api.ChatInvite) {
    return { chatId: null, title: result.title, alreadyMember: false };
  }
  throw new UpstreamError('Telegram returned an unrecognised invite preview');
}

function classifyCheckError(err: unknown): never {
  const msg = errorMessage(err).toUpperCase();
  if (NOT_FOUND_PATTERNS.test(msg)) {
    throw new NotFoundError('invite link');
  }
  if (PRIVATE_PATTERNS.test(msg)) {
    throw new UpstreamError('invite link is private or restricted', 'private_channel');
  }
  throw new UpstreamError('Telegram check-invite failed');
}

export function createImportInvite(client: InviteClient, logger: Logger): ImportInviteFn {
  return async (hash) => {
    let updates: Api.TypeUpdates;
    try {
      updates = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
    } catch (err) {
      const msg = errorMessage(err).toUpperCase();
      if (/USER_ALREADY_PARTICIPANT/i.test(msg)) {
        // Already a member — fall back to a check call to fetch the chat
        // info so the caller still gets a chatId for storage.
        try {
          const preview = await checkInvite(client, hash);
          return { status: 'ok', chatId: preview.chatId, title: preview.title };
        } catch (checkErr) {
          logger.warn(
            { err: checkErr, hashPrefix: redactInviteHash(hash) },
            'check-after-already-participant failed',
          );
          return { status: 'no_access', chatId: null, title: null };
        }
      }
      logger.warn({ err, hashPrefix: redactInviteHash(hash) }, 'ImportChatInvite failed');
      return { status: 'no_access', chatId: null, title: null };
    }
    const chats: unknown[] = (updates as { chats?: unknown[] }).chats ?? [];
    const chat = chats[0];
    return {
      status: 'ok',
      chatId: chat ? chatIdFromInviteChat(chat) : null,
      title: chat ? chatTitle(chat) : null,
    };
  };
}
