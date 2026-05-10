import { Api } from 'telegram';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createJoinChannel, type JoinChannelClient } from './joinChannel.js';

const logger = createLogger({ silent: true });

// gramjs's TL types expect `BigInteger` from the `big-integer` package, but
// the package isn't in the server's direct deps. At runtime gramjs accepts
// native bigint just as well — these casts are purely to satisfy tsc.
type GramJsLong = ConstructorParameters<typeof Api.InputPeerChannel>[0]['channelId'];
const asLong = (n: number): GramJsLong => BigInt(n) as unknown as GramJsLong;

function makeChannelPeer(): Api.InputPeerChannel {
  return new Api.InputPeerChannel({
    channelId: asLong(1234567890),
    accessHash: asLong(987654321),
  });
}

interface ClientStub {
  getInputEntity?: (id: string) => Promise<unknown>;
  getEntity?: (id: string) => Promise<unknown>;
  invoke?: (req: unknown) => Promise<unknown>;
}

function makeClient(overrides: ClientStub = {}): JoinChannelClient {
  // Cast through unknown — gramjs `TelegramClient['getEntity']` and friends
  // are heavily overloaded; the structural mock just needs to satisfy how
  // joinChannel.ts uses them at runtime.
  return {
    getInputEntity: vi.fn(overrides.getInputEntity ?? (async () => makeChannelPeer())),
    getEntity: vi.fn(overrides.getEntity ?? (async () => ({}))),
    invoke: vi.fn(overrides.invoke ?? (async () => ({}))),
  } as unknown as JoinChannelClient;
}

describe('createJoinChannel', () => {
  it('returns ok when JoinChannel succeeds for a -100 channel', async () => {
    const invoke = vi.fn(async () => ({}));
    const join = createJoinChannel(makeClient({ invoke }), logger);
    expect(await join('-1001234567890')).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('returns ok on USER_ALREADY_PARTICIPANT (idempotent re-join)', async () => {
    const invoke = vi.fn(async () => {
      const err: Error & { errorMessage?: string } = new Error('USER_ALREADY_PARTICIPANT');
      err.errorMessage = 'USER_ALREADY_PARTICIPANT';
      throw err;
    });
    const join = createJoinChannel(makeClient({ invoke }), logger);
    expect(await join('-1001234567890')).toBe('ok');
  });

  it('returns no_access on CHANNEL_PRIVATE', async () => {
    const invoke = vi.fn(async () => {
      const err: Error & { errorMessage?: string } = new Error('CHANNEL_PRIVATE');
      err.errorMessage = 'CHANNEL_PRIVATE';
      throw err;
    });
    const join = createJoinChannel(makeClient({ invoke }), logger);
    expect(await join('-1001234567890')).toBe('no_access');
  });

  it('returns no_access on USERS_TOO_MUCH', async () => {
    const invoke = vi.fn(async () => {
      const err: Error & { errorMessage?: string } = new Error('USERS_TOO_MUCH');
      err.errorMessage = 'USERS_TOO_MUCH';
      throw err;
    });
    const join = createJoinChannel(makeClient({ invoke }), logger);
    expect(await join('-1001234567890')).toBe('no_access');
  });

  it('returns no_access on an unknown error (with a warn log)', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('UNCLASSIFIED_BOOM');
    });
    const join = createJoinChannel(makeClient({ invoke }), logger);
    expect(await join('-1001234567890')).toBe('no_access');
  });

  it('returns no_access if getInputEntity itself fails', async () => {
    const getInputEntity = vi.fn(async () => {
      throw new Error('PEER_ID_INVALID');
    });
    const invoke = vi.fn();
    const join = createJoinChannel(makeClient({ getInputEntity, invoke }), logger);
    expect(await join('-1001234567890')).toBe('no_access');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns no_access if -100 id resolves to a non-channel peer', async () => {
    const getInputEntity = vi.fn(
      async () => new Api.InputPeerUser({ userId: asLong(42), accessHash: asLong(99) }),
    );
    const invoke = vi.fn();
    const join = createJoinChannel(makeClient({ getInputEntity, invoke }), logger);
    expect(await join('-1001234567890')).toBe('no_access');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('falls back to getEntity for non-channel ids (basic group, user DM)', async () => {
    // sourceChatId without `-100` prefix — JoinChannel doesn't apply.
    const getEntity = vi.fn(async () => ({}));
    const invoke = vi.fn();
    const join = createJoinChannel(makeClient({ getEntity, invoke }), logger);
    expect(await join('123456789')).toBe('ok');
    expect(getEntity).toHaveBeenCalledWith('123456789');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns no_access for non-channel ids when getEntity fails', async () => {
    const getEntity = vi.fn(async () => {
      throw new Error('PEER_ID_INVALID');
    });
    const join = createJoinChannel(makeClient({ getEntity }), logger);
    expect(await join('-987654')).toBe('no_access');
  });
});
