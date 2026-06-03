// Downloads the chat photo (no public URL) as a data: URL. Never throws — any failure returns null.
// 200 KB cap is defensive: real thumbnails are <30 KB, so a jump implies a wrong-size variant.
import type { TelegramClient } from 'telegram';
import type { Logger } from '../lib/logger.js';

export type ProfilePhotoFetcher = (chatId: string) => Promise<string | null>;

const MAX_PHOTO_BYTES = 200 * 1024;

export interface ProfilePhotoClient {
  getEntity: TelegramClient['getEntity'];
  downloadProfilePhoto: TelegramClient['downloadProfilePhoto'];
}

export function createProfilePhotoFetcher(
  client: ProfilePhotoClient,
  logger: Logger,
): ProfilePhotoFetcher {
  return async (chatId) => {
    // Widen to unknown: the overloaded getEntity alias resolves to the array form.
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
      // Empty buffer = no profile photo, not an error.
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
