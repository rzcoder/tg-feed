/**
 * gramjs `client.getEntity` adapter for the resolve endpoint.
 *
 * The web UI's "Add subscription" flow accepts an `@username` or
 * `t.me/...` link and asks the server to look it up. This wraps gramjs in
 * a small interface so the API server can be unit-tested without a live
 * Telegram connection (tests inject a stub resolver).
 *
 * The resolver normalises the input, then maps gramjs error names to the
 * typed `AppError` hierarchy. Anything we can't classify is rethrown as a
 * generic `UpstreamError` (503) — never leak gramjs internals to clients.
 */
import type { TelegramClient } from 'telegram';
import { NotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';

export interface ResolvedEntity {
  sourceChatId: string;
  sourceTitle: string;
  handle: string | null;
}

export type EntityResolver = (input: string) => Promise<ResolvedEntity>;

export function normaliseHandle(input: string): string {
  let s = input.trim();
  if (!s) throw new ValidationError('input is required');
  // Strip URL prefix variants.
  s = s.replace(/^https?:\/\//i, '');
  // t.me/foo, telegram.me/foo, telegram.dog/foo
  s = s.replace(/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i, '');
  // Strip leading `@`.
  s = s.replace(/^@+/, '');
  // Strip trailing path / query.
  s = s.replace(/[/?#].*$/, '');
  if (!s) throw new ValidationError('input is required');
  if (!/^[A-Za-z0-9_]{4,32}$/.test(s)) {
    throw new ValidationError('expected a Telegram username (4–32 letters / digits / underscores)');
  }
  return s;
}

const KNOWN_NOT_FOUND = new Set(['USERNAME_NOT_OCCUPIED', 'USERNAME_INVALID']);
const KNOWN_PRIVATE = new Set(['CHANNEL_PRIVATE', 'CHANNEL_INVALID']);

interface GramJsErrorLike {
  errorMessage?: string;
  message?: string;
  code?: number;
}

function classifyGramJsError(err: unknown, handle: string): never {
  const e = err as GramJsErrorLike;
  const msg = (e?.errorMessage ?? e?.message ?? '').toUpperCase();
  for (const code of KNOWN_NOT_FOUND) {
    if (msg.includes(code)) {
      throw new NotFoundError(`channel @${handle}`);
    }
  }
  for (const code of KNOWN_PRIVATE) {
    if (msg.includes(code)) {
      throw new UpstreamError(`channel @${handle} is private or invalid`, 'private_channel');
    }
  }
  throw new UpstreamError(`Telegram resolve failed for @${handle}`);
}

export function createEntityResolver(client: TelegramClient): EntityResolver {
  return async (input) => {
    const handle = normaliseHandle(input);
    let entity: unknown;
    try {
      entity = await client.getEntity(handle);
    } catch (err) {
      classifyGramJsError(err, handle);
    }
    return entityToResolved(entity, handle);
  };
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
