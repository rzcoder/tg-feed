// Pure input-parsing + entity → DTO mapping; no gramjs dependency so tests need no Telegram stub.
import { UpstreamError, ValidationError } from '../lib/errors.js';

export interface ResolvedEntity {
  sourceChatId: string;
  sourceTitle: string;
  handle: string | null;
}

// Accepts @username, t.me/username, t.me/+HASH or +HASH invite, or a numeric chat id (-100… channel/supergroup, bare positive for user/basic group).
export type ParsedInput =
  | { kind: 'handle'; value: string }
  | { kind: 'invite'; hash: string }
  | { kind: 'chatId'; value: string };

const HANDLE_RE = /^[A-Za-z0-9_]{4,32}$/;
const INVITE_HASH_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CHAT_ID_RE = /^-?\d{6,}$/;

export function parseInput(input: string): ParsedInput {
  let s = input.trim();
  if (!s) throw new ValidationError('input is required');
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i, '');
  // Legacy invite form `joinchat/<hash>` — capture the hash before the trailing-path strip
  // below collapses it to the bare word `joinchat`, which would mis-classify as a handle.
  const joinchat = s.match(/^joinchat\/([^/?#]+)/i);
  if (joinchat) {
    const hash = joinchat[1]!;
    if (!INVITE_HASH_RE.test(hash)) {
      throw new ValidationError('expected a Telegram invite hash after `joinchat/`');
    }
    return { kind: 'invite', hash };
  }
  // Strip trailing path/query before classifying so `t.me/+HASH/123` still resolves.
  s = s.replace(/[/?#].*$/, '');
  if (!s) throw new ValidationError('input is required');

  if (s.startsWith('+')) {
    const hash = s.slice(1);
    if (!INVITE_HASH_RE.test(hash)) {
      throw new ValidationError('expected a Telegram invite hash after `+`');
    }
    return { kind: 'invite', hash };
  }

  if (CHAT_ID_RE.test(s)) {
    return { kind: 'chatId', value: s };
  }

  const handle = s.replace(/^@+/, '');
  if (!HANDLE_RE.test(handle)) {
    throw new ValidationError('expected a Telegram username, invite link, or numeric chat id');
  }
  return { kind: 'handle', value: handle };
}

interface MaybeEntity {
  id?: { toString: () => string } | number | string;
  title?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export function entityToResolved(raw: unknown, handle: string): ResolvedEntity {
  const e = raw as MaybeEntity;
  if (!e?.id) throw new UpstreamError(`Telegram returned an unrecognised entity for @${handle}`);
  const idStr = typeof e.id === 'object' ? e.id.toString() : String(e.id);
  // getEntity returns positive channel ids; storage convention is the -100 supergroup form (users/bots keep the bare id).
  const sourceChatId = sourceChatIdFor(idStr, raw);
  const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
  const sourceTitle = e.title ?? (fullName !== '' ? fullName : handle);
  const username = e.username ? `@${e.username}` : null;
  return { sourceChatId, sourceTitle, handle: username ?? `@${handle}` };
}

function sourceChatIdFor(idStr: string, raw: unknown): string {
  // Structural className check to avoid dragging telegram into the type surface.
  const className = (raw as { className?: string })?.className ?? '';
  if (className === 'Channel' || className === 'Chat') {
    return idStr.startsWith('-') ? idStr : `-100${idStr}`;
  }
  return idStr;
}
