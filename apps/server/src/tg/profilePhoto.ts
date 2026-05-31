/**
 * Profile-photo fetcher used at subscription/destination create and as a
 * lazy backfill from the access monitor.
 *
 * Telegram doesn't expose chat photos as public URLs — gramjs has to
 * download the bytes via `client.downloadProfilePhoto`. We encode the
 * small thumbnail as a `data:image/jpeg;base64,...` URL so it can ride
 * inline in the list DTOs and the UI can drop it straight into an `<img>`.
 *
 * The fetcher never throws: any failure (no photo, gramjs error, oversize
 * buffer) returns `null` so callers can store the result without
 * guarding. The 200 KB cap is defensive — small profile photos are
 * typically <30 KB and a sudden jump would suggest a wrong-size variant
 * was returned.
 */
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';

export type ProfilePhotoFetcher = (chatId: string) => Promise<string | null>;

const MAX_PHOTO_BYTES = 200 * 1024;

// Subset of `TelegramClient` we depend on so tests can pass a stub.
export interface ProfilePhotoClient {
  getEntity: TelegramClient['getEntity'];
  downloadProfilePhoto: TelegramClient['downloadProfilePhoto'];
}

export function createProfilePhotoFetcher(
  client: ProfilePhotoClient,
  logger: Logger,
): ProfilePhotoFetcher {
  return async (chatId) => {
    // gramjs's `getEntity` is overloaded (single id → Entity, array → Entity[]);
    // TS resolves the alias to the array form, so we widen to `unknown` here
    // and let `downloadProfilePhoto`'s `EntityLike` signature accept it.
    let entity: unknown;
    try {
      entity = await client.getEntity(chatId);
    } catch (err) {
      logger.debug({ err, chatId }, 'profile photo fetch: getEntity failed');
      return null;
    }
    let buf: Buffer | string | undefined;
    try {
      buf = await client.downloadProfilePhoto(
        entity as Parameters<TelegramClient['downloadProfilePhoto']>[0],
        { isBig: false },
      );
    } catch (err) {
      logger.debug({ err, chatId }, 'profile photo fetch: downloadProfilePhoto failed');
      return null;
    }
    if (!buf || typeof buf === 'string' || buf.byteLength === 0) {
      // gramjs returns an empty Buffer (or nothing) when the entity has
      // no profile photo — not an error condition, just a null result.
      return null;
    }
    if (buf.byteLength > MAX_PHOTO_BYTES) {
      logger.debug(
        { chatId, bytes: buf.byteLength },
        'profile photo fetch: discarded oversize buffer',
      );
      return null;
    }
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  };
}
