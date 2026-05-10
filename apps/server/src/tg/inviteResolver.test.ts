import { describe, expect, it, vi } from 'vitest';
import { Api } from 'telegram';
import { NotFoundError, UpstreamError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import {
  chatIdFromInviteChat,
  checkInvite,
  createImportInvite,
  type InviteClient,
} from './inviteResolver.js';

const silentLogger = createLogger({ silent: true });

function makeChannel(id: string | bigint, title: string): unknown {
  // Mimic the shape gramjs hands back without standing up the real class.
  return { id: { toString: () => id.toString() }, title, className: 'Channel' };
}

describe('chatIdFromInviteChat', () => {
  it('prefixes -100 for Channel className when not already negative', () => {
    expect(chatIdFromInviteChat(makeChannel('1234567890', 'X'))).toBe('-1001234567890');
  });
  it('preserves an already-negative id', () => {
    expect(chatIdFromInviteChat({ id: '-1001234567890', className: 'Channel' })).toBe(
      '-1001234567890',
    );
  });
  it('returns null for malformed input', () => {
    expect(chatIdFromInviteChat(null)).toBeNull();
    expect(chatIdFromInviteChat({})).toBeNull();
  });
});

describe('checkInvite', () => {
  it('returns chat info for ChatInviteAlready (already a member)', async () => {
    const chat = makeChannel('1234567890', 'Joined Channel');
    const stub: InviteClient = {
      invoke: vi.fn().mockResolvedValue(
        Object.assign(Object.create(Api.ChatInviteAlready.prototype), {
          chat,
          className: 'ChatInviteAlready',
        }),
      ) as unknown as InviteClient['invoke'],
    };
    const result = await checkInvite(stub, 'HASH');
    expect(result).toEqual({
      chatId: '-1001234567890',
      title: 'Joined Channel',
      alreadyMember: true,
    });
  });

  it('returns null chatId for ChatInvite (not yet a member)', async () => {
    const stub: InviteClient = {
      invoke: vi.fn().mockResolvedValue(
        Object.assign(Object.create(Api.ChatInvite.prototype), {
          title: 'Secret Channel',
          participantsCount: 42,
          className: 'ChatInvite',
        }),
      ) as unknown as InviteClient['invoke'],
    };
    const result = await checkInvite(stub, 'HASH');
    expect(result).toEqual({
      chatId: null,
      title: 'Secret Channel',
      alreadyMember: false,
    });
  });

  it('returns chat info for ChatInvitePeek', async () => {
    const chat = makeChannel('99', 'Peek Channel');
    const stub: InviteClient = {
      invoke: vi.fn().mockResolvedValue(
        Object.assign(Object.create(Api.ChatInvitePeek.prototype), {
          chat,
          expires: 0,
          className: 'ChatInvitePeek',
        }),
      ) as unknown as InviteClient['invoke'],
    };
    const result = await checkInvite(stub, 'HASH');
    expect(result.chatId).toBe('-10099');
    expect(result.title).toBe('Peek Channel');
    expect(result.alreadyMember).toBe(false);
  });

  it('maps INVITE_HASH_EXPIRED → NotFoundError', async () => {
    const stub: InviteClient = {
      invoke: vi
        .fn()
        .mockRejectedValue(
          new Error('INVITE_HASH_EXPIRED: link expired'),
        ) as unknown as InviteClient['invoke'],
    };
    await expect(checkInvite(stub, 'HASH')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps INVITE_HASH_INVALID → NotFoundError', async () => {
    const stub: InviteClient = {
      invoke: vi
        .fn()
        .mockRejectedValue(new Error('INVITE_HASH_INVALID')) as unknown as InviteClient['invoke'],
    };
    await expect(checkInvite(stub, 'HASH')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps CHANNEL_PRIVATE → UpstreamError with code private_channel', async () => {
    const stub: InviteClient = {
      invoke: vi
        .fn()
        .mockRejectedValue(new Error('CHANNEL_PRIVATE')) as unknown as InviteClient['invoke'],
    };
    await expect(checkInvite(stub, 'HASH')).rejects.toMatchObject({
      name: UpstreamError.name,
      code: 'private_channel',
    });
  });

  it('maps unknown errors → generic UpstreamError', async () => {
    const stub: InviteClient = {
      invoke: vi.fn().mockRejectedValue(new Error('TIMEOUT')) as unknown as InviteClient['invoke'],
    };
    await expect(checkInvite(stub, 'HASH')).rejects.toMatchObject({
      name: UpstreamError.name,
      code: 'upstream_unavailable',
    });
  });
});

describe('createImportInvite', () => {
  it('returns ok + chatId derived from the first chat in Updates', async () => {
    const chat = makeChannel('1234567890', 'Joined Channel');
    const stub: InviteClient = {
      invoke: vi
        .fn()
        .mockResolvedValue({ chats: [chat], users: [] }) as unknown as InviteClient['invoke'],
    };
    const importInvite = createImportInvite(stub, silentLogger);
    const result = await importInvite('HASH');
    expect(result).toEqual({
      status: 'ok',
      chatId: '-1001234567890',
      title: 'Joined Channel',
    });
  });

  it('falls back to checkInvite on USER_ALREADY_PARTICIPANT', async () => {
    const chat = makeChannel('99', 'Already Channel');
    const invoke = vi
      .fn()
      // First call: ImportChatInvite throws.
      .mockRejectedValueOnce(new Error('USER_ALREADY_PARTICIPANT'))
      // Second call: CheckChatInvite returns ChatInviteAlready.
      .mockResolvedValueOnce(
        Object.assign(Object.create(Api.ChatInviteAlready.prototype), {
          chat,
          className: 'ChatInviteAlready',
        }),
      );
    const importInvite = createImportInvite(
      { invoke: invoke as unknown as InviteClient['invoke'] },
      silentLogger,
    );
    const result = await importInvite('HASH');
    expect(result).toEqual({ status: 'ok', chatId: '-10099', title: 'Already Channel' });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('returns no_access on INVITE_HASH_EXPIRED', async () => {
    const stub: InviteClient = {
      invoke: vi
        .fn()
        .mockRejectedValue(new Error('INVITE_HASH_EXPIRED')) as unknown as InviteClient['invoke'],
    };
    const importInvite = createImportInvite(stub, silentLogger);
    const result = await importInvite('HASH');
    expect(result).toEqual({ status: 'no_access', chatId: null, title: null });
  });

  it('returns no_access on unclassified errors', async () => {
    const stub: InviteClient = {
      invoke: vi.fn().mockRejectedValue(new Error('TIMEOUT')) as unknown as InviteClient['invoke'],
    };
    const importInvite = createImportInvite(stub, silentLogger);
    const result = await importInvite('HASH');
    expect(result.status).toBe('no_access');
  });
});
