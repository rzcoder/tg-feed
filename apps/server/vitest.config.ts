import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
