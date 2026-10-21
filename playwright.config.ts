import { defineConfig } from '@playwright/test';
const port = Number(process.env.WOBILLIG_TEST_PORT || 5179);
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.ts', fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI },
});
