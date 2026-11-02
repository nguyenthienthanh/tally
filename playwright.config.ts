import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:7788', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node dist/cli.js serve --port=7788',
    url: 'http://127.0.0.1:7788/api/now',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
