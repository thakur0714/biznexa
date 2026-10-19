import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running stack (seeded API on :4000 with E2E_DISABLE_THROTTLE=1, web on :3000).
 *   pnpm --filter @biznexa/web e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
