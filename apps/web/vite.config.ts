import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(moduleDir, 'src'),
    },
  },
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        // SSE needs a long-lived response stream; disable proxy buffering.
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
