import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const devPort = Number(process.env.SUPPORT_WORKBENCH_FRONTEND_PORT ?? 4173);
const apiProxyTarget = process.env.SUPPORT_WORKBENCH_API_PROXY_TARGET ?? 'http://localhost:4317';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: devPort,
    proxy: {
      '/api': apiProxyTarget
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
});
