import { describe, it, expect } from 'vitest';
import { SHARED_PACKAGE_VERSION } from './index.js';

describe('@tg-feed/shared', () => {
  it('exports a version constant', () => {
    expect(SHARED_PACKAGE_VERSION).toBe('0.1.0');
  });
});
