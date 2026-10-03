import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))
const baseURL = 'http://127.0.0.1:5187'

export default defineConfig({
  testDir: '.',
  testMatch: 'bootstrap-*.spec.ts',
  outputDir: '.artifacts/bootstrap-held-css-results',
  reporter: 'list',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 4_000 },
  use: { baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 5187',
    cwd: webappRoot,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
