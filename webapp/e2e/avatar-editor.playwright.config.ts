import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.', testMatch: /(?:avatar-editor|child-avatar|adult-avatar)\.spec\.ts/, fullyParallel: false, workers: 1, timeout: 30_000,
  reporter: 'list', outputDir: '.artifacts/avatar-editor-results',
  use: { baseURL: 'http://127.0.0.1:5188', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'bun run dev --host 127.0.0.1 --port 5188', url: 'http://127.0.0.1:5188', reuseExistingServer: false, timeout: 60_000 },
})
