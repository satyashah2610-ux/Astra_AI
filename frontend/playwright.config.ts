import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const python = process.platform === 'win32' ? '".venv/Scripts/python.exe"' : '".venv/bin/python"';
// Emails from the test backend go to this folder (never sent); tests read reset links from it.
// Playwright loads this file again in each worker: keep the first folder name so both sides agree.
const outbox = process.env.ASTRA_E2E_OUTBOX ??= resolve(tmpdir(), `astra-e2e-outbox-${Date.now()}`);
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list',
  webServer: [
    { command: `${python} backend/scripts/run_e2e_backend.py`, cwd: root, url: 'http://127.0.0.1:8011/api/health', reuseExistingServer: false, env: { ASTRA_DATA_DIR: resolve(tmpdir(), `astra-e2e-${Date.now()}`), ASTRA_EMAIL_OUTBOX: outbox, ASTRA_ENV_DIR: resolve(tmpdir(), 'astra-e2e-no-env-files') } },
    // The built app (vite preview), not the dev server: no live reload or on-the-fly rebuilding mid-test, closer to production.
    // stdout is piped so TypeScript errors from `tsc -b` (printed to stdout) show when the build fails.
    { command: 'npm run build && npm run preview -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', timeout: 180000, stdout: 'pipe', reuseExistingServer: false, env: { API_TARGET: 'http://127.0.0.1:8011' } },
  ],
});
