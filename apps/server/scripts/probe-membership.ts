/**
 * Read-only diagnostic: for every enabled subscription, ask Telegram whether
 * the userbot is *actually* a participant of that source channel, not just
 * whether it can resolve the entity.
 *
 * Motivation: `accessMonitor` currently uses `client.getEntity(chatId)`, which
 * succeeds for any public channel whether or not we're subscribed. A channel
 * the userbot can resolve but isn't a member of will be stamped as
 * `source_access_status='ok'` while silently producing no `NewMessage`
 * events — the listener never matches a message, no `forward_log` row is
 * ever written, and the symptom looks like "the service just doesn't forward
 * this channel". This script makes that state visible without touching the DB.
 *
 * Usage: `pnpm --filter @tg-feed/server probe-membership`
 */
import '../src/lib/loadEnv.js';
import process from 'node:process';
import { Api } from 'telegram';
import { desc, eq } from 'drizzle-orm';
import { config } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { forwardLog, subscriptions } from '../src/db/schema.js';
import { createLogger } from '../src/lib/logger.js';
import { createTelegramClient, disconnectClient, resolveTelegramEnv } from '../src/tg/client.js';

type Status = 'member' | 'left' | 'not_participant' | 'no_access' | 'unknown';

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

interface Row {
  id: number;
  title: string;
  handle: string | null;
  sourceChatId: string;
  dbStatus: 'ok' | 'no_access';
  status: Status;
  inDialogs: 'yes' | 'no';
  detail: string;
  lastMessageId: string;
  lastMessageAge: string;
  lastMessageClass: string;
  lastForwardAge: string;
}

async function main(): Promise<void> {
  const logger = createLogger({ silent: true });
  const { db, sqlite } = createDb(config.DATABASE_PATH);
  const envResult = resolveTelegramEnv({ cfg: config, db, logger });
  if (!envResult.ok || !envResult.env) {
    console.error(`Cannot connect to Telegram: ${envResult.reason ?? 'unknown reason'}`);
    sqlite.close();
    process.exit(2);
  }
  const client = createTelegramClient(envResult.env);
  try {
    await client.connect();
  } catch (err) {
    console.error(`Telegram connect failed: ${err instanceof Error ? err.message : String(err)}`);
    sqlite.close();
    process.exit(2);
  }

  const subs = db
    .select({
      id: subscriptions.id,
      title: subscriptions.sourceTitle,
      handle: subscriptions.handle,
      sourceChatId: subscriptions.sourceChatId,
      dbStatus: subscriptions.sourceAccessStatus,
    })
    .from(subscriptions)
    .where(eq(subscriptions.enabled, true))
    .all();

  // Fetch dialogs once and build a set of chat ids the userbot's session
  // currently has in its update routing table. Membership ≠ being in dialogs:
  // gramjs only delivers `UpdateNewChannelMessage` events for channels the
  // session has registered as a dialog.
  const dialogIds = await fetchDialogChatIds(client);

  const rows: Row[] = [];
  for (const sub of subs) {
    const { status, detail } = await probe(client, sub.sourceChatId);
    const last = await fetchLastMessage(client, sub.sourceChatId);
    const lastForward = db
      .select({ createdAt: forwardLog.createdAt })
      .from(forwardLog)
      .where(eq(forwardLog.subscriptionId, sub.id))
      .orderBy(desc(forwardLog.createdAt))
      .limit(1)
      .get();
    rows.push({
      id: sub.id,
      title: sub.title,
      handle: sub.handle,
      sourceChatId: sub.sourceChatId,
      dbStatus: sub.dbStatus,
      status,
      inDialogs: dialogIds.has(sub.sourceChatId) ? 'yes' : 'no',
      detail,
      lastMessageId: last.id,
      lastMessageAge: last.age,
      lastMessageClass: last.className,
      lastForwardAge: lastForward
        ? humanAge(Date.now() - lastForward.createdAt.getTime())
        : 'never',
    });
  }

  printTable(rows);

  await disconnectClient(client);
  sqlite.close();
  // gramjs leaves an internal reconnect timer around briefly after disconnect.
  // The destroy() in disconnectClient handles cleanup; exit explicitly so
  // the process doesn't hang on a stray handle.
  process.exit(0);
}

async function fetchDialogChatIds(
  client: ReturnType<typeof createTelegramClient>,
): Promise<Set<string>> {
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    const ids = new Set<string>();
    for (const dlg of dialogs) {
      const id = (dlg.id as unknown as { toString?: () => string } | null)?.toString?.();
      if (typeof id === 'string') ids.add(id);
    }
    return ids;
  } catch (err) {
    console.error(`getDialogs failed: ${errorMessage(err) || String(err)}`);
    return new Set();
  }
}

async function fetchLastMessage(
  client: ReturnType<typeof createTelegramClient>,
  chatId: string,
): Promise<{ id: string; age: string; className: string }> {
  try {
    const history = (await client.invoke(
      new Api.messages.GetHistory({
        peer: chatId,
        limit: 1,
      }),
    )) as { messages?: Array<{ id?: number; date?: number; className?: string }> };
    const msg = history.messages?.[0];
    if (!msg || typeof msg.id !== 'number') return { id: '-', age: '-', className: '-' };
    const ageMs = msg.date ? Date.now() - msg.date * 1000 : null;
    return {
      id: String(msg.id),
      age: ageMs === null ? '-' : humanAge(ageMs),
      className: msg.className ?? '-',
    };
  } catch (err) {
    return { id: 'err', age: errorMessage(err).slice(0, 20) || 'err', className: 'err' };
  }
}

function humanAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

async function probe(
  client: ReturnType<typeof createTelegramClient>,
  chatId: string,
): Promise<{ status: Status; detail: string }> {
  // Channel-like ids (broadcast channels and supergroups) get the proper
  // membership probe. DMs / basic groups don't have a participant API; for
  // those, `getEntity` resolvability is the best signal we have.
  if (!chatId.startsWith('-100')) {
    try {
      await client.getEntity(chatId);
      return { status: 'member', detail: 'non-channel, resolvable' };
    } catch (err) {
      const msg = errorMessage(err);
      if (NO_ACCESS_PATTERNS.some((p) => p.test(msg))) {
        return { status: 'no_access', detail: msg };
      }
      return { status: 'unknown', detail: msg || String(err) };
    }
  }

  let inputPeer: Api.TypeInputPeer;
  try {
    inputPeer = await client.getInputEntity(chatId);
  } catch (err) {
    const msg = errorMessage(err);
    if (NO_ACCESS_PATTERNS.some((p) => p.test(msg))) {
      return { status: 'no_access', detail: msg };
    }
    return { status: 'unknown', detail: msg || String(err) };
  }
  if (!(inputPeer instanceof Api.InputPeerChannel)) {
    return { status: 'no_access', detail: 'id resolved to non-channel input peer' };
  }
  const channel = new Api.InputChannel({
    channelId: inputPeer.channelId,
    accessHash: inputPeer.accessHash,
  });

  try {
    const result = (await client.invoke(
      new Api.channels.GetParticipant({
        channel,
        participant: new Api.InputPeerSelf(),
      }),
    )) as { participant?: { className?: string } };
    const className = result?.participant?.className ?? 'unknown';
    if (className === 'ChannelParticipantLeft') {
      return { status: 'left', detail: className };
    }
    return { status: 'member', detail: className };
  } catch (err) {
    const msg = errorMessage(err);
    if (/USER_NOT_PARTICIPANT/i.test(msg)) {
      return { status: 'not_participant', detail: msg };
    }
    if (NO_ACCESS_PATTERNS.some((p) => p.test(msg))) {
      return { status: 'no_access', detail: msg };
    }
    return { status: 'unknown', detail: msg || String(err) };
  }
}

function printTable(rows: Row[]): void {
  const headers = [
    'id',
    'title',
    'handle',
    'source_chat_id',
    'db',
    'actual',
    'in_dialogs',
    'last_msg_id',
    'last_msg_age',
    'last_msg_class',
    'last_fwd_age',
    'detail',
  ];
  const data = rows.map((r) => [
    String(r.id),
    truncate(r.title, 24),
    r.handle ?? '',
    r.sourceChatId,
    r.dbStatus,
    r.status,
    r.inDialogs,
    r.lastMessageId,
    r.lastMessageAge,
    r.lastMessageClass,
    r.lastForwardAge,
    truncate(r.detail, 40),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i]!.length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of data) console.log(line(row));

  const drift = rows.filter((r) => r.dbStatus === 'ok' && r.status !== 'member');
  if (drift.length > 0) {
    console.log('');
    console.log(
      `Drift: ${drift.length} subscription(s) have source_access_status='ok' in DB but the userbot is NOT actually a member.`,
    );
    console.log(
      'These channels will silently produce no forward_log entries until the userbot rejoins.',
    );
  } else {
    console.log('');
    console.log('No drift — every ok-stamped subscription is actually a member.');
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
