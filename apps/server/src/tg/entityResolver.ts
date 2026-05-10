/**
 * Input parsing + entity → DTO mapping shared by `chatResolver` and the
 * invite resolver.
 *
 * This module no longer wraps gramjs directly — `chatResolver.ts` does that,
 * dispatching on the `parseInput` discriminator. The two helpers exported
 * here are pure: tests don't need a Telegram stub to exercise them.
 */
import { UpstreamError, ValidationError } from '../lib/errors.js';

export interface ResolvedEntity {
  sourceChatId: string;
  sourceTitle: string;
  handle: string | null;
}

/**
 * Discriminated classification of a paste-the-source-here input. The web UI
 * accepts any of: `@username`, `t.me/username`, `t.me/+HASH` private invite,
 * `+HASH` raw invite, or a numeric chat id (`-100…` channels/supergroups
 * or bare positive ids for users / basic groups).
 */
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
  // Strip URL prefix variants.
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i, '');
  // Strip trailing path / query (e.g. `t.me/foo/123`, `t.me/foo?x=1`). We do
  // this before classifying so a paste like `t.me/+HASH/123` still resolves.
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
  // Channels arrive as positive ids from getEntity; the storage convention
  // (matching what the listener sees) is the supergroup form prefixed -100.
  // For users / bots the bare positive id is correct.
  const sourceChatId = sourceChatIdFor(idStr, raw);
  const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
  const sourceTitle = e.title ?? (fullName !== '' ? fullName : handle);
  const username = e.username ? `@${e.username}` : null;
  return { sourceChatId, sourceTitle, handle: username ?? `@${handle}` };
}

function sourceChatIdFor(idStr: string, raw: unknown): string {
  // gramjs Channel/Chat carry a className; we can't import the class here
  // without dragging telegram into the type surface, so do a structural check.
  const className = (raw as { className?: string })?.className ?? '';
  if (className === 'Channel' || className === 'Chat') {
    return idStr.startsWith('-') ? idStr : `-100${idStr}`;
  }
  return idStr;
}
