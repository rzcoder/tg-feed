import { describe, expect, it } from 'vitest';
import { createLoginSessionStore } from './loginSession.js';
import { createLogger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

const logger = createLogger({ silent: true });

describe('loginSession.validateRaw', () => {
  it('rejects a too-short session string with a 400 ValidationError', async () => {
    const store = createLoginSessionStore({ apiId: 1, apiHash: 'x', logger });
    try {
      await expect(store.validateRaw('short')).rejects.toThrow(/empty or too short/);
    } finally {
      await store.shutdown();
    }
  });

  it('rejects a malformed session string with a 400 invalid_session_string (no 500)', async () => {
    const store = createLoginSessionStore({ apiId: 1, apiHash: 'x', logger });
    try {
      // gramjs StringSession throws `Error("Not a valid string")` because
      // the first byte isn't the version literal "1". Without explicit
      // handling this escapes as a 500; the route should see a 400 AppError.
      const garbage = 'this-is-clearly-not-a-valid-session-string';
      let caught: unknown;
      try {
        await store.validateRaw(garbage);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect(caught).toMatchObject({
        statusCode: 400,
        code: 'invalid_session_string',
      });
      expect((caught as AppError).message).toMatch(/malformed/i);
    } finally {
      await store.shutdown();
    }
  });
});
