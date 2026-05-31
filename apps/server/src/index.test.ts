import { describe, it, expect } from 'vitest';
import { SHARED_PACKAGE_VERSION } from '@tg-feed/shared';

describe('@tg-feed/server smoke', () => {
  it('imports from @tg-feed/shared', () => {
    expect(typeof SHARED_PACKAGE_VERSION).toBe('string');
    expect(SHARED_PACKAGE_VERSION.length).toBeGreaterThan(0);
  });
});
