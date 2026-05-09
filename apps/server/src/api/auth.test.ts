import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { requireWebAuthEnv, verifyPassword } from './auth.js';

const SESSION_SECRET = 'a'.repeat(32);

describe('requireWebAuthEnv', () => {
  it('returns the parsed shape when both vars are present', () => {
    const cfg = parseConfig({ WEB_PASSWORD: 'hunter2', SESSION_SECRET });
    expect(requireWebAuthEnv(cfg)).toEqual({
      password: 'hunter2',
      sessionSecret: SESSION_SECRET,
    });
  });
  it('throws listing WEB_PASSWORD when missing', () => {
    const cfg = parseConfig({ SESSION_SECRET });
    expect(() => requireWebAuthEnv(cfg)).toThrow(/WEB_PASSWORD/);
  });
  it('throws listing SESSION_SECRET when missing', () => {
    const cfg = parseConfig({ WEB_PASSWORD: 'hunter2' });
    expect(() => requireWebAuthEnv(cfg)).toThrow(/SESSION_SECRET/);
  });
  it('throws listing both when both missing', () => {
    const cfg = parseConfig({});
    expect(() => requireWebAuthEnv(cfg)).toThrow(/WEB_PASSWORD.*SESSION_SECRET/);
  });
});

describe('verifyPassword', () => {
  it('returns true for an exact match', () => {
    expect(verifyPassword('hunter2', 'hunter2')).toBe(true);
  });
  it('returns false for a mismatch of equal length', () => {
    expect(verifyPassword('hunter2', 'hunter3')).toBe(false);
  });
  it('returns false for a different-length plain', () => {
    expect(verifyPassword('short', 'longer-password')).toBe(false);
  });
  it('returns false when plain is empty', () => {
    expect(verifyPassword('', 'hunter2')).toBe(false);
  });
  it('returns true when both sides are empty (SHA-256 collision-free comparison)', () => {
    expect(verifyPassword('', '')).toBe(true);
  });
});
