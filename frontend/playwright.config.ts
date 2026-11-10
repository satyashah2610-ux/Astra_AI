import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const python = process.platform === 'win32' ? '".venv/Scripts/python.exe"' : '".venv/bin/python"';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list',
  webServer: [
    { command: `${python} backend/scripts/run_e2e_backend.py`, cwd: root, url: 'http://127.0.0.1:8011/api/health', reuseExistingServer: false, env: { ASTRA_DATA_DIR: resolve(tmpdir(), `astra-e2e-${Date.now()}`) } },
    { command: 'npm run dev -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false, env: { API_TARGET: 'http://127.0.0.1:8011' } },
  ],
});
