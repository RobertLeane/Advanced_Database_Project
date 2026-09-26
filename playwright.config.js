import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Screenshots, traces and videos are intentionally disabled: they can contain credentials.
  use: { baseURL: 'http://localhost:5173', browserName: 'chromium', channel: 'msedge', headless: true, screenshot: 'off', trace: 'off', video: 'off' },
  webServer: { command: 'npm run start', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 60000 }
});
