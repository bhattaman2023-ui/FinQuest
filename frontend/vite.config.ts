import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const sourcePath = decodeURIComponent(
  new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': sourcePath,
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
