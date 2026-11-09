import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Keep the browser's Host header: the backend compares it with the request's Origin (cross-site protection).
    proxy: { '/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
