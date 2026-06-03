// Adapts gramjs TelegramClient to ForwarderClient, adding forum-topic forwarding: client.forwardMessages has no topMsgId, so the topic path drops to the raw messages.ForwardMessages request (which carries it). No-topic forwards delegate to the helper.
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { ForwarderClient } from './forwarder.js';

// _getResponseMessage is internal-but-public on TelegramClient; narrow the cast surface.
interface ResponseMessageClient {
  _getResponseMessage(
    req: unknown,
    result: unknown,
    inputChat: unknown,
  ): Api.TypeMessage | Map<number, Api.Message> | (Api.Message | undefined)[] | undefined;
}

function normalizeSent(
  sent: ReturnType<ResponseMessageClient['_getResponseMessage']>,
): ReadonlyArray<{ id?: number } | null | undefined> {
  if (sent == null) return [];
  if (Array.isArray(sent)) return sent;
  if (sent instanceof Map) return [...sent.values()];
  return [sent];
}

export function createForwarderClient(client: TelegramClient): ForwarderClient {
  return {
    async forwardMessages(entity, { messages, fromPeer, silent, topMsgId }) {
      if (topMsgId === undefined) {
        return client.forwardMessages(entity, {
          messages,
          fromPeer,
          ...(silent !== undefined ? { silent } : {}),
        });
      }
      // Resolve both peers to InputPeers and set topMsgId so the forward lands in the chosen topic.
      const toPeer = await client.getInputEntity(entity);
      const fromPeerResolved = await client.getInputEntity(fromPeer);
      const request = new Api.messages.ForwardMessages({
        fromPeer: fromPeerResolved,
        toPeer,
        id: messages,
        topMsgId,
        ...(silent !== undefined ? { silent } : {}),
      });
      const result = await client.invoke(request);
      const sent = (client as unknown as ResponseMessageClient)._getResponseMessage(
        request,
        result,
        toPeer,
      );
      return normalizeSent(sent);
    },
  };
}
