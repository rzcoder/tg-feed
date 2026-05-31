import { describe, expect, it, vi } from 'vitest';
import { Api } from 'telegram';
import { NotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';
import { createChatResolver, type ChatResolverClient } from './chatResolver.js';

function makeStub(overrides: Partial<ChatResolverClient> = {}): ChatResolverClient {
  return {
    getEntity: vi.fn() as unknown as ChatResolverClient['getEntity'],
    invoke: vi.fn() as unknown as ChatResolverClient['invoke'],
    ...overrides,
  };
}

describe('createChatResolver', () => {
  it('handle path: dispatches to getEntity and uses entityToResolved', async () => {
    const getEntity = vi.fn().mockResolvedValue({
      id: { toString: () => '1234567890' },
      title: 'Anthropic',
      username: 'anthropic_ai',
      className: 'Channel',
    });
    const resolver = createChatResolver(
      makeStub({ getEntity: getEntity as unknown as ChatResolverClient['getEntity'] }),
    );
    const result = await resolver('https://t.me/anthropic_ai');
    expect(result).toEqual({
      chatId: '-1001234567890',
      title: 'Anthropic',
      handle: '@anthropic_ai',
      inviteHash: null,
      alreadyMember: true,
    });
    expect(getEntity).toHaveBeenCalledWith('anthropic_ai');
  });

  it('chatId path: uses input as the storage id, fills title from getEntity', async () => {
    const getEntity = vi.fn().mockResolvedValue({
      id: '-1001234567890',
      title: 'Channel by id',
      className: 'Channel',
    });
    const resolver = createChatResolver(
      makeStub({ getEntity: getEntity as unknown as ChatResolverClient['getEntity'] }),
    );
    const result = await resolver('-1001234567890');
    expect(result.chatId).toBe('-1001234567890');
    expect(result.title).toBe('Channel by id');
    expect(result.inviteHash).toBeNull();
    expect(result.alreadyMember).toBe(true);
    expect(getEntity).toHaveBeenCalledWith('-1001234567890');
  });

  it('invite path (already member): returns chatId from CheckChatInvite + the hash', async () => {
    const chat = { id: { toString: () => '99' }, title: 'Joined', className: 'Channel' };
    const invoke = vi.fn().mockResolvedValue(
      Object.assign(Object.create(Api.ChatInviteAlready.prototype), {
        chat,
        className: 'ChatInviteAlready',
      }),
    );
    const resolver = createChatResolver(
      makeStub({ invoke: invoke as unknown as ChatResolverClient['invoke'] }),
    );
    const result = await resolver('https://t.me/+LtdmkRfh24oxZjYy');
    expect(result).toEqual({
      chatId: '-10099',
      title: 'Joined',
      handle: null,
      inviteHash: 'LtdmkRfh24oxZjYy',
      alreadyMember: true,
    });
  });

  it('invite path (not yet member): returns null chatId + the hash', async () => {
    const invoke = vi.fn().mockResolvedValue(
      Object.assign(Object.create(Api.ChatInvite.prototype), {
        title: 'Secret',
        participantsCount: 5,
        className: 'ChatInvite',
      }),
    );
    const resolver = createChatResolver(
      makeStub({ invoke: invoke as unknown as ChatResolverClient['invoke'] }),
    );
    const result = await resolver('+LtdmkRfh24oxZjYy');
    expect(result.chatId).toBeNull();
    expect(result.title).toBe('Secret');
    expect(result.inviteHash).toBe('LtdmkRfh24oxZjYy');
    expect(result.alreadyMember).toBe(false);
  });

  it('handle path: maps USERNAME_NOT_OCCUPIED → NotFoundError', async () => {
    const getEntity = vi.fn().mockRejectedValue(new Error('USERNAME_NOT_OCCUPIED'));
    const resolver = createChatResolver(
      makeStub({ getEntity: getEntity as unknown as ChatResolverClient['getEntity'] }),
    );
    await expect(resolver('@foo_bar')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('handle path: maps CHANNEL_PRIVATE → UpstreamError(private_channel)', async () => {
    const getEntity = vi.fn().mockRejectedValue(new Error('CHANNEL_PRIVATE'));
    const resolver = createChatResolver(
      makeStub({ getEntity: getEntity as unknown as ChatResolverClient['getEntity'] }),
    );
    await expect(resolver('@foo_bar')).rejects.toMatchObject({
      name: UpstreamError.name,
      code: 'private_channel',
    });
  });

  it('chatId path: maps PEER_ID_INVALID → NotFoundError', async () => {
    const getEntity = vi.fn().mockRejectedValue(new Error('PEER_ID_INVALID'));
    const resolver = createChatResolver(
      makeStub({ getEntity: getEntity as unknown as ChatResolverClient['getEntity'] }),
    );
    await expect(resolver('-1001234567890')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid input shape with ValidationError (propagated from parseInput)', async () => {
    const resolver = createChatResolver(makeStub());
    await expect(resolver('!!!')).rejects.toBeInstanceOf(ValidationError);
  });
});
