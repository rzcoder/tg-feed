import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createProfilePhotoFetcher, type ProfilePhotoClient } from './profilePhoto.js';

const logger = createLogger({ silent: true });

interface ClientStub {
  getEntity?: (id: string) => Promise<unknown>;
  downloadProfilePhoto?: (
    entity: unknown,
    opts?: { isBig?: boolean },
  ) => Promise<Buffer | string | undefined>;
}

function makeClient(overrides: ClientStub = {}): ProfilePhotoClient {
  return {
    getEntity: vi.fn(overrides.getEntity ?? (async () => ({ id: 'entity' }))),
    downloadProfilePhoto: vi.fn(
      overrides.downloadProfilePhoto ?? (async () => Buffer.from([0xff, 0xd8, 0xff])),
    ),
  } as unknown as ProfilePhotoClient;
}

describe('createProfilePhotoFetcher', () => {
  it('returns a JPEG data URL when downloadProfilePhoto produces bytes', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const fetch = createProfilePhotoFetcher(
      makeClient({ downloadProfilePhoto: async () => buf }),
      logger,
    );
    const result = await fetch('-1001234567890');
    expect(result).toBe(`data:image/jpeg;base64,${buf.toString('base64')}`);
  });

  it('returns null when getEntity fails', async () => {
    const fetch = createProfilePhotoFetcher(
      makeClient({
        getEntity: async () => {
          throw new Error('CHANNEL_PRIVATE');
        },
      }),
      logger,
    );
    expect(await fetch('-1001234567890')).toBeNull();
  });

  it('returns null when downloadProfilePhoto throws', async () => {
    const fetch = createProfilePhotoFetcher(
      makeClient({
        downloadProfilePhoto: async () => {
          throw new Error('PHOTO_FILE_REFERENCE_INVALID');
        },
      }),
      logger,
    );
    expect(await fetch('-1001234567890')).toBeNull();
  });

  it('returns null when the buffer is empty (no profile photo)', async () => {
    const fetch = createProfilePhotoFetcher(
      makeClient({ downloadProfilePhoto: async () => Buffer.alloc(0) }),
      logger,
    );
    expect(await fetch('-1001234567890')).toBeNull();
  });

  it('returns null when downloadProfilePhoto resolves to undefined', async () => {
    const fetch = createProfilePhotoFetcher(
      makeClient({ downloadProfilePhoto: async () => undefined }),
      logger,
    );
    expect(await fetch('-1001234567890')).toBeNull();
  });

  it('returns null when the buffer exceeds the 200 KB cap', async () => {
    const oversize = Buffer.alloc(201 * 1024, 0xab);
    const fetch = createProfilePhotoFetcher(
      makeClient({ downloadProfilePhoto: async () => oversize }),
      logger,
    );
    expect(await fetch('-1001234567890')).toBeNull();
  });

  it('passes isBig:false to downloadProfilePhoto (small thumbnail)', async () => {
    const dl = vi.fn(async () => Buffer.from([1, 2, 3]));
    const fetch = createProfilePhotoFetcher(makeClient({ downloadProfilePhoto: dl }), logger);
    await fetch('-1001234567890');
    expect(dl).toHaveBeenCalledWith(expect.anything(), { isBig: false });
  });
});
