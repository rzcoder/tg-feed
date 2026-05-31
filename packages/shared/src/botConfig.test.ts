import { describe, expect, it } from 'vitest';
import {
  botConfigInfoSchema,
  resolveBotAdminRequestSchema,
  resolveBotAdminResponseSchema,
  updateBotConfigRequestSchema,
} from './botConfig.js';

const VALID_TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const adminEntry = (id: string) => ({ id, displayName: null, username: null });

describe('updateBotConfigRequestSchema', () => {
  it('accepts a valid token / admins / publicUrl', () => {
    expect(
      updateBotConfigRequestSchema.safeParse({
        token: VALID_TOKEN,
        admins: [{ id: '111', displayName: 'Jane', username: 'jane' }, adminEntry('222')],
        publicUrl: 'https://tg-feed.example.com',
      }).success,
    ).toBe(true);
  });

  it('accepts a single field', () => {
    expect(updateBotConfigRequestSchema.safeParse({ admins: [adminEntry('111')] }).success).toBe(
      true,
    );
  });

  it('accepts null to clear a field', () => {
    expect(
      updateBotConfigRequestSchema.safeParse({ token: null, admins: null, publicUrl: null })
        .success,
    ).toBe(true);
  });

  it('rejects an empty body (at least one field required)', () => {
    expect(updateBotConfigRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(updateBotConfigRequestSchema.safeParse({ token: 'not-a-token' }).success).toBe(false);
    expect(updateBotConfigRequestSchema.safeParse({ token: '123:short' }).success).toBe(false);
  });

  it('rejects a non-numeric admin id', () => {
    expect(updateBotConfigRequestSchema.safeParse({ admins: [adminEntry('abc')] }).success).toBe(
      false,
    );
  });

  it('rejects a non-URL public URL', () => {
    expect(updateBotConfigRequestSchema.safeParse({ publicUrl: 'not a url' }).success).toBe(false);
  });
});

describe('resolveBotAdmin schemas', () => {
  it('requires a non-empty query', () => {
    expect(resolveBotAdminRequestSchema.safeParse({ query: '@jane' }).success).toBe(true);
    expect(resolveBotAdminRequestSchema.safeParse({ query: '' }).success).toBe(false);
  });

  it('parses a resolved user', () => {
    expect(
      resolveBotAdminResponseSchema.safeParse({ id: '777', displayName: 'Jane', username: 'jane' })
        .success,
    ).toBe(true);
  });
});

describe('botConfigInfoSchema', () => {
  it('parses a masked info payload', () => {
    const parsed = botConfigInfoSchema.safeParse({
      tokenConfigured: true,
      tokenSource: 'db',
      encryptionKeyConfigured: true,
      keyFingerprintMismatch: false,
      admins: [{ id: '111', displayName: 'Jane', username: 'jane' }],
      adminsSource: 'db',
      publicUrl: null,
      publicUrlSource: null,
      botRunning: true,
    });
    expect(parsed.success).toBe(true);
  });
});
