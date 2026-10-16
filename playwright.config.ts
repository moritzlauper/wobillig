import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.ts', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5179', channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 5179', url: 'http://127.0.0.1:5179', reuseExistingServer: !process.env.CI },
});
