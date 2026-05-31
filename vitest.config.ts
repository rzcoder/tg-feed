import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['{apps,packages}/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/dist/**'],
    },
  },
});
