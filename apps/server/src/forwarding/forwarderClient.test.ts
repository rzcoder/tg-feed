import { describe, it, expect, vi } from 'vitest';
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import { createForwarderClient } from './forwarderClient.js';

describe('createForwarderClient', () => {
  it('delegates to the high-level helper when no topic is set', async () => {
    const forwardMessages = vi.fn().mockResolvedValue([{ id: 111 }]);
    const invoke = vi.fn();
    const client = createForwarderClient({
      forwardMessages,
      invoke,
      getInputEntity: vi.fn(),
    } as unknown as TelegramClient);

    const sent = await client.forwardMessages('-100DEST', {
      messages: [1, 2],
      fromPeer: '-100SRC',
    });

    expect(forwardMessages).toHaveBeenCalledWith('-100DEST', {
      messages: [1, 2],
      fromPeer: '-100SRC',
    });
    // The raw-request path must not be taken when there's no topic.
    expect(invoke).not.toHaveBeenCalled();
    expect(sent).toEqual([{ id: 111 }]);
  });

  it('issues a raw ForwardMessages with topMsgId (and auto randomId) for a forum topic', async () => {
    const forwardMessages = vi.fn();
    const getInputEntity = vi
      .fn()
      .mockResolvedValueOnce({ peer: 'dest' })
      .mockResolvedValueOnce({ peer: 'src' });
    const invoke = vi.fn().mockResolvedValue({ updates: [] });
    const _getResponseMessage = vi.fn().mockReturnValue([{ id: 555 }, { id: 556 }]);
    const client = createForwarderClient({
      forwardMessages,
      invoke,
      getInputEntity,
      _getResponseMessage,
    } as unknown as TelegramClient);

    const sent = await client.forwardMessages('-100DEST', {
      messages: [10, 11],
      fromPeer: '-100SRC',
      topMsgId: 7,
    });

    // High-level helper is bypassed; the raw request carries the topic.
    expect(forwardMessages).not.toHaveBeenCalled();
    expect(getInputEntity).toHaveBeenNthCalledWith(1, '-100DEST');
    expect(getInputEntity).toHaveBeenNthCalledWith(2, '-100SRC');
    expect(invoke).toHaveBeenCalledTimes(1);
    const request = invoke.mock.calls[0]![0] as Api.messages.ForwardMessages;
    expect(request).toBeInstanceOf(Api.messages.ForwardMessages);
    expect(request.topMsgId).toBe(7);
    expect(request.id).toEqual([10, 11]);
    // gramjs auto-generates one randomId per id in the constructor.
    expect(request.randomId).toHaveLength(2);
    expect(sent).toEqual([{ id: 555 }, { id: 556 }]);
  });

  it('normalizes a single-message response into an array', async () => {
    const _getResponseMessage = vi.fn().mockReturnValue({ id: 777 });
    const client = createForwarderClient({
      forwardMessages: vi.fn(),
      invoke: vi.fn().mockResolvedValue({}),
      getInputEntity: vi.fn().mockResolvedValue({ peer: 'x' }),
      _getResponseMessage,
    } as unknown as TelegramClient);

    const sent = await client.forwardMessages('-100DEST', {
      messages: [10],
      fromPeer: '-100SRC',
      topMsgId: 3,
    });
    expect(sent).toEqual([{ id: 777 }]);
  });
});
