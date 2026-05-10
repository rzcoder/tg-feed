import { describe, expect, it } from 'vitest';
import { NotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';
import { createEntityResolver, entityToResolved, normaliseHandle } from './entityResolver.js';

type ResolverClient = Parameters<typeof createEntityResolver>[0];

describe('normaliseHandle', () => {
  it('strips https://, t.me/, leading @, and trailing path/query', () => {
    expect(normaliseHandle('https://t.me/anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('http://t.me/anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('https://telegram.me/anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('t.me/anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('@anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('@@anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('anthropic_ai')).toBe('anthropic_ai');
    expect(normaliseHandle('https://t.me/anthropic_ai/123')).toBe('anthropic_ai');
    expect(normaliseHandle('https://t.me/anthropic_ai?bar=1')).toBe('anthropic_ai');
    expect(normaliseHandle('  anthropic_ai  ')).toBe('anthropic_ai');
  });
  it('rejects empty input', () => {
    expect(() => normaliseHandle('')).toThrow(ValidationError);
    expect(() => normaliseHandle('   ')).toThrow(ValidationError);
    expect(() => normaliseHandle('@')).toThrow(ValidationError);
  });
  it('rejects too-short or too-long names', () => {
    expect(() => normaliseHandle('abc')).toThrow(ValidationError);
    expect(() => normaliseHandle('a'.repeat(33))).toThrow(ValidationError);
  });
  it('rejects non-letter/digit/underscore characters', () => {
    expect(() => normaliseHandle('foo-bar')).toThrow(ValidationError);
    expect(() => normaliseHandle('foo bar')).toThrow(ValidationError);
    expect(() => normaliseHandle('foo.bar')).toThrow(ValidationError);
  });
});

describe('entityToResolved', () => {
  it('handles a Channel with title and username', () => {
    const result = entityToResolved(
      {
        id: { toString: () => '1234567890' },
        title: 'Anthropic',
        username: 'anthropic_ai',
        className: 'Channel',
      },
      'anthropic_ai',
    );
    expect(result.sourceChatId).toBe('-1001234567890');
    expect(result.sourceTitle).toBe('Anthropic');
    expect(result.handle).toBe('@anthropic_ai');
  });

  it('handles a Channel without a username (handle falls back to provided handle)', () => {
    const result = entityToResolved(
      { id: 1234567890, title: 'Private Channel', className: 'Channel' },
      'somehandle',
    );
    expect(result.sourceChatId).toBe('-1001234567890');
    expect(result.handle).toBe('@somehandle');
  });

  it('handles a User entity (positive id, no -100 prefix)', () => {
    const result = entityToResolved(
      {
        id: { toString: () => '42' },
        firstName: 'Alice',
        lastName: 'Smith',
        username: 'alice',
      },
      'alice',
    );
    expect(result.sourceChatId).toBe('42');
    expect(result.sourceTitle).toBe('Alice Smith');
    expect(result.handle).toBe('@alice');
  });

  it('throws UpstreamError on missing id', () => {
    expect(() => entityToResolved({ title: 'x' }, 'x')).toThrow(UpstreamError);
  });

  it('falls back sourceTitle to handle when no title or names', () => {
    const result = entityToResolved({ id: { toString: () => '1' }, username: 'bot' }, 'bot');
    expect(result.sourceTitle).toBe('bot');
  });
});

describe('createEntityResolver error mapping', () => {
  it('maps USERNAME_NOT_OCCUPIED → NotFoundError', async () => {
    const stub = {
      getEntity: () => {
        throw new Error('USERNAME_NOT_OCCUPIED: this username is not occupied');
      },
    } as unknown as ResolverClient;
    const resolver = createEntityResolver(stub);
    await expect(resolver('foo_bar')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps CHANNEL_PRIVATE → UpstreamError with code private_channel', async () => {
    const stub = {
      getEntity: () => {
        throw new Error('CHANNEL_PRIVATE: this channel is private');
      },
    } as unknown as ResolverClient;
    const resolver = createEntityResolver(stub);
    await expect(resolver('foo_bar')).rejects.toMatchObject({
      name: UpstreamError.name,
      code: 'private_channel',
    });
  });

  it('maps unknown gramjs errors → UpstreamError generic', async () => {
    const stub = {
      getEntity: () => {
        throw new Error('TIMEOUT');
      },
    } as unknown as ResolverClient;
    const resolver = createEntityResolver(stub);
    await expect(resolver('foo_bar')).rejects.toMatchObject({
      name: UpstreamError.name,
      code: 'upstream_unavailable',
    });
  });
});
