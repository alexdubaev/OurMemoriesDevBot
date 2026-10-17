import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: 'fullscreen-swipe.spec.ts',
  outputDir: '.artifacts/fullscreen-swipe-results',
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 4_000 },
  use: { baseURL: 'http://127.0.0.1:5197' },
  projects: [
    { name: 'iphone-chromium-cdp-touch', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android-chromium-cdp-touch', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'iphone-webkit-synthetic-touch', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 5197',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    env: { VITE_MEMOLY_UI_VERSION: 'v2' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
})
