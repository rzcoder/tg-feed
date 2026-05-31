import { describe, expect, it } from 'vitest';
import { toJsonSafe } from './jsonSafe.js';

describe('toJsonSafe', () => {
  it('returns null for null/undefined input', () => {
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(undefined)).toBeNull();
  });

  it('returns null for MessageEmpty / MessageService', () => {
    expect(toJsonSafe({ className: 'MessageEmpty', id: 1 })).toBeNull();
    expect(toJsonSafe({ className: 'MessageService', id: 1 })).toBeNull();
  });

  it('returns a plain POJO for a Message-like input', () => {
    const result = toJsonSafe({
      className: 'Message',
      id: 42,
      message: 'hi',
      media: null,
    });
    expect(result).toEqual({
      className: 'Message',
      id: 42,
      message: 'hi',
      media: null,
    });
  });

  it('converts native BigInt to string', () => {
    const result = toJsonSafe({ groupedId: 12345678901234567890n, id: 1 });
    expect(result).toEqual({ groupedId: '12345678901234567890', id: 1 });
  });

  it("invokes a value's toJSON (mirrors gramjs TLObject serialization)", () => {
    // gramjs BigInteger / Buffer both rely on toJSON; emulate the contract.
    const fakeBigInt = { toJSON: () => '987654321' };
    const fakeBuffer = { toJSON: () => 'base64==' };
    const result = toJsonSafe({
      className: 'Message',
      id: fakeBigInt,
      media: { bytes: fakeBuffer },
    });
    expect(result).toEqual({
      className: 'Message',
      id: '987654321',
      media: { bytes: 'base64==' },
    });
  });

  it('replaces cycles with a sentinel instead of throwing', () => {
    const a: Record<string, unknown> = { className: 'Message', id: 1 };
    const b: Record<string, unknown> = { a };
    a.b = b;
    const result = toJsonSafe(a) as { className: string; id: number; b: { a: unknown } };
    expect(result.className).toBe('Message');
    expect(result.id).toBe(1);
    // The first object is seen, so the back-reference becomes the sentinel.
    expect(result.b.a).toBe('[Circular]');
  });

  it('replaces value with a truncation marker when over the size cap', () => {
    const big = 'x'.repeat(200);
    const result = toJsonSafe({ className: 'Message', payload: big }, { maxBytes: 50 });
    expect(result).toEqual({ __truncated: true, size: expect.any(Number) });
    expect((result as { size: number }).size).toBeGreaterThan(50);
  });

  it('returns null when the value throws inside its toJSON', () => {
    const bad = {
      className: 'Message',
      toJSON: () => {
        throw new Error('boom');
      },
    };
    expect(toJsonSafe(bad)).toBeNull();
  });
});
