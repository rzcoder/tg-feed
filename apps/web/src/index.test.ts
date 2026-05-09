import { describe, it, expect } from 'vitest';
import { WEB_PLACEHOLDER } from './index.js';

describe('@tg-feed/web smoke', () => {
  it('exports a placeholder until Chapter 9 wires up Vite + React', () => {
    expect(WEB_PLACEHOLDER).toMatch(/^web@/);
  });
});
