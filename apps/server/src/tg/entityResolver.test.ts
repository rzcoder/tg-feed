import { describe, expect, it } from 'vitest';
import { UpstreamError, ValidationError } from '../lib/errors.js';
import { entityToResolved, parseInput } from './entityResolver.js';

describe('parseInput', () => {
  it('classifies handles (with prefix variants) as { kind: "handle" }', () => {
    expect(parseInput('https://t.me/anthropic_ai')).toEqual({
      kind: 'handle',
      value: 'anthropic_ai',
    });
    expect(parseInput('http://t.me/anthropic_ai')).toEqual({
      kind: 'handle',
      value: 'anthropic_ai',
    });
    expect(parseInput('https://telegram.me/anthropic_ai')).toEqual({
      kind: 'handle',
      value: 'anthropic_ai',
    });
    expect(parseInput('t.me/anthropic_ai')).toEqual({ kind: 'handle', value: 'anthropic_ai' });
    expect(parseInput('@anthropic_ai')).toEqual({ kind: 'handle', value: 'anthropic_ai' });
    expect(parseInput('@@anthropic_ai')).toEqual({ kind: 'handle', value: 'anthropic_ai' });
    expect(parseInput('anthropic_ai')).toEqual({ kind: 'handle', value: 'anthropic_ai' });
    expect(parseInput('https://t.me/anthropic_ai/123')).toEqual({
      kind: 'handle',
      value: 'anthropic_ai',
    });
    expect(parseInput('https://t.me/anthropic_ai?bar=1')).toEqual({
      kind: 'handle',
      value: 'anthropic_ai',
    });
    expect(parseInput('  anthropic_ai  ')).toEqual({ kind: 'handle', value: 'anthropic_ai' });
  });

  it('classifies invite links as { kind: "invite" }', () => {
    expect(parseInput('https://t.me/+LtdmkRfh24oxZjYy')).toEqual({
      kind: 'invite',
      hash: 'LtdmkRfh24oxZjYy',
    });
    expect(parseInput('http://t.me/+LtdmkRfh24oxZjYy')).toEqual({
      kind: 'invite',
      hash: 'LtdmkRfh24oxZjYy',
    });
    expect(parseInput('t.me/+LtdmkRfh24oxZjYy')).toEqual({
      kind: 'invite',
      hash: 'LtdmkRfh24oxZjYy',
    });
    expect(parseInput('+LtdmkRfh24oxZjYy')).toEqual({ kind: 'invite', hash: 'LtdmkRfh24oxZjYy' });
    // Hyphen / underscore allowed in hashes.
    expect(parseInput('+abc-def_ghi')).toEqual({ kind: 'invite', hash: 'abc-def_ghi' });
    // Trailing junk after the hash is stripped.
    expect(parseInput('https://t.me/+LtdmkRfh/extra?q=1')).toEqual({
      kind: 'invite',
      hash: 'LtdmkRfh',
    });
  });

  it('classifies numeric ids as { kind: "chatId" }', () => {
    expect(parseInput('-1001234567890')).toEqual({ kind: 'chatId', value: '-1001234567890' });
    expect(parseInput('1234567')).toEqual({ kind: 'chatId', value: '1234567' });
    expect(parseInput('  -1001234567  ')).toEqual({ kind: 'chatId', value: '-1001234567' });
  });

  it('rejects empty input', () => {
    expect(() => parseInput('')).toThrow(ValidationError);
    expect(() => parseInput('   ')).toThrow(ValidationError);
    expect(() => parseInput('@')).toThrow(ValidationError);
  });

  it('rejects too-short / too-long handles', () => {
    expect(() => parseInput('abc')).toThrow(ValidationError);
    expect(() => parseInput('a'.repeat(33))).toThrow(ValidationError);
  });

  it('rejects handles with disallowed characters', () => {
    expect(() => parseInput('foo-bar')).toThrow(ValidationError);
    expect(() => parseInput('foo bar')).toThrow(ValidationError);
    expect(() => parseInput('foo.bar')).toThrow(ValidationError);
  });

  it('rejects an invite hash with disallowed characters', () => {
    expect(() => parseInput('+abc.def')).toThrow(ValidationError);
    expect(() => parseInput('+')).toThrow(ValidationError);
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
