/**
 * Adapts the live gramjs `TelegramClient` to the forwarder's `ForwarderClient`
 * interface, adding forum-topic support the high-level helper lacks.
 *
 * gramjs's `client.forwardMessages` accepts only `{ messages, fromPeer,
 * silent, ... }` — there is no `topMsgId`. To forward into a forum topic we
 * fall back to the raw `messages.ForwardMessages` request, which does carry
 * `topMsgId`. gramjs auto-generates the required `randomId` vector in the
 * request constructor (one per `id`), and `_getResponseMessage` is the same
 * extractor the helper uses to turn the `Updates` result into messages — so
 * the topic path produces the same `{ id }[]` shape the no-topic path does.
 *
 * The no-topic path delegates verbatim to the helper, leaving normal chats
 * (and a forum's General topic, which omits `topMsgId`) on the proven code
 * path.
 */
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { ForwarderClient } from './forwarder.js';

// `_getResponseMessage` is an internal-but-public method on TelegramClient
// (used by the high-level send/forward helpers). Narrow the surface we touch
// so the cast stays honest.
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
      // Raw request path: resolve both peers to input peers (the TL layer
      // needs concrete `InputPeer`s, exactly as the helper does) and set
      // `topMsgId` so the forward lands in the chosen forum topic.
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
